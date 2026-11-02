
const ogmiosApi = require("./CardanoApiOgmios");
const Web3 = require("web3");
const web3 = new Web3();
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const CoinSelectionService = require('../bizServices/utxoSelectionService');
const CommonUtils = require("../util/common");



function buildOgmiosService(){
	let option = {
		"host": "http://52.13.9.234",
		"port": 4337
	}

	let ogmiosInst = new ogmiosApi(option);
	return ogmiosInst;
}


function buildCoinSelectionInst(){
	let addrPrefix = "addr_test";
	let coinSelectionInst = new CoinSelectionService(addrPrefix);

	return coinSelectionInst;
}


function convertUtxosFormat(utxos){
	let ret = new Array();

	for (let i = 0; i < utxos.length; i++) {
		const utxo = utxos[i];
		let mapAsset = new Map();
		let coinsAmount = undefined;

		for (let j = 0; j < utxo.amount.length; j++) {
			if ("lovelace" === utxo.amount[j].unit) {
				// if (coinValue && CardanoWasm.BigNum.from_str(utxo.amount[j].quantity + '').compare(
				//     CardanoWasm.BigNum.from_str('' + coinValue)
				// ) < 0) break;
				let bnCoinAmount = mapAsset[utxo.amount[j].unit];
				if (undefined === bnCoinAmount) {
					bnCoinAmount = CardanoWasm.BigNum.from_str('0');
				}
				bnCoinAmount = bnCoinAmount.checked_add(CardanoWasm.BigNum.from_str(utxo.amount[j].quantity + ''));

				coinsAmount = bnCoinAmount.to_str();

			} else {
				// this.logger.debug("..plutusNftTxBuilder......asset unit: ", utxo.amount[j].unit, utxo.amount[j].quantity + '')
				let bnAssetAmount = mapAsset[utxo.amount[j].unit];
				if (undefined === bnAssetAmount) {
					bnAssetAmount = CardanoWasm.BigNum.from_str('0');
				}
				bnAssetAmount = bnAssetAmount.checked_add(CardanoWasm.BigNum.from_str(utxo.amount[j].quantity + ''));

				// let assetUnit = utxo.amount[j].unit.replace(".", "");
				let assetUnit = utxo.amount[j].unit;
				mapAsset[assetUnit] = bnAssetAmount.to_str();
			}
		}

		// filter utxo with null datum
		ret.push({
			txHash: utxo.tx_hash,
			index: utxo.tx_index,
			value: {
				coins: coinsAmount,
				assets: mapAsset
			},
			address: utxo.address,
			datum: utxo.data_hash,
			datumHash: utxo.datumHash,
			script: utxo.script,
			blockHeight: utxo.blockHeight
		});
	}

	return ret;
}


async function main(){
	let ogmiosInst = buildOgmiosService();

	// to get protocolParams
	let protocolParams = await ogmiosInst.getCurrentProtocolParameters();
	console.log("\n\n...getCurrentProtocolParameters ret: ", protocolParams);	
	let minFeeA = JSON.stringify(protocolParams.minFeeCoefficient);
	let minFeeB = JSON.stringify(protocolParams.minFeeConstant);
	let coinsPerUtxoByte = JSON.stringify(protocolParams.coinsPerUtxoByte);
	console.log("\n\n...coinsPerUtxoByte ret: ", coinsPerUtxoByte);	
	console.log("...minFeeA ret: ", minFeeA);	
	console.log("...minFeeB ret: ", minFeeB);

	// to get utxos by address
	let payAddress	= "addr_test1wr64gtafm8rpkndue4ck2nx95u4flhwf643l2qmg9emjajg2ww0nj";
	let pageNumber	= 1;
	let countNumber	= 100;
	let order = 'asc';
	let ret = await ogmiosInst.getAddressUTXOs(payAddress, pageNumber, countNumber, order);
	let utxos = ret.utxos;
	console.log("\n\n...getAddressUTXOs ret: ", utxos);

	// let commonUtilObj = new CommonUtils("addr_test");
	let formatedUtxos = convertUtxosFormat(utxos);
	for(let i=0; i<formatedUtxos.length; i++){
		let utxoItem = formatedUtxos[i];
		let utxoValue = utxoItem.value;

		let adaAmount = utxoValue.coins;
		let assetAmount = utxoValue.assets;
		console.log("\n\n...utxo id: ", i);
		console.log("...utxo ada: ", adaAmount);
		console.log("...utxo asset: ", assetAmount);
	}


	let commonUtilObj = new CommonUtils("addr_test");
	let availableUtxos = commonUtilObj.formatUtxoData(formatedUtxos);
	console.log("\n\n...availableUtxos ret: ", availableUtxos);
	for(let i=0; i<availableUtxos.length; i++){
		let txOut = availableUtxos[i].txOut;
		console.log("...utxo txOut: ", txOut);
	}


	let coinSelectionInst = buildCoinSelectionInst();
	coinSelectionInst.setProtocolParameters(coinsPerUtxoByte, minFeeA, minFeeB, maxTxSize='10000');

	let transferAmount = new Array();
	// 5e4a2431a465a00dc5d8181aaff63959bb235d97013e7acb50b55bc4.4e6f646546656564
	// 5e4a2431a465a00dc5d8181aaff63959bb235d97013e7acb50b55bc4.4167675374617465
	// 5e4a2431a465a00dc5d8181aaff63959bb235d97013e7acb50b55bc4.4f7261636c6546656564
	
	let amountItemA = {
		"unit": "5e4a2431a465a00dc5d8181aaff63959bb235d97013e7acb50b55bc4",
		"name": "4e6f646546656564",
		"amount": "2"
	};	
	transferAmount.push(amountItemA);

	let amountItemB = {
		"unit": "5e4a2431a465a00dc5d8181aaff63959bb235d97013e7acb50b55bc4",
		"name": "4f7261636c6546656564",
		"amount": "1"
	};
	transferAmount.push(amountItemB);

	// let amountItemC = {
	// 	"unit": "5e4a2431a465a00dc5d8181aaff63959bb235d97013e7acb50b55bc4",
	// 	"name": "4167675374617465",
	// 	"amount": "1"
	// };
	// transferAmount.push(amountItemC);

	let toAddress = "addr_test1qz6twkzgss75sk379u0e27phvwhmtqqfuhl5gnx7rh7nux2xg4uwrhx9t58far8hp3a06hfdfzlsxgfrzqv5ryc78e4s4dwh26";
	let limit = 3;
	let bNFTMode = true;
	let selectedUtxos = coinSelectionInst.selectUtxos(availableUtxos, toAddress, transferAmount, limit, bNFTMode);
	console.log("\n\n...selectedUtxos ret: ", selectedUtxos);

}

main()
