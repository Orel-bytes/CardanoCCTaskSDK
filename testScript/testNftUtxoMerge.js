
const ogmiosApi = require("./CardanoApiOgmios");
const Web3 = require("web3");
const web3 = new Web3();
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const CommonUtils = require("../util/common");
const commonUtilObj = new CommonUtils("addr_test");


const payAddress = "addr_test1qz00m4e5fzffpfnjul8mtths5zyxlrmajj50p92s5t5whvx20svrzzfppwa39zz2l8fwk560fvdghkrzwfkrzghzawxq782gkg";
const toAddress = "addr_test1qz6twkzgss75sk379u0e27phvwhmtqqfuhl5gnx7rh7nux2xg4uwrhx9t58far8hp3a06hfdfzlsxgfrzqv5ryc78e4s4dwh26";
const MaxUtxoNum = 5;
const PriorityFactor = 5;


function buildOgmiosService() {
	let option = {
		"host": "http://52.13.9.234",
		"port": 4337
	}

	let ogmiosInst = new ogmiosApi(option);
	return ogmiosInst;
}

function convertUtxosFormat(utxos) {
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
				// console.log("..plutusNftTxBuilder......asset unit: ", utxo.amount[j].unit, utxo.amount[j].quantity + '')
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

function buildMultiNftAmount(nftAmountObj) {
	// Step 1-1: to coin select treasury utxos for transfer
	let transferAmount = new Array();

	console.log("\n\n...buildMultiNftAmount: ");
	for (let tokenId in nftAmountObj) {
		let tokenAmount = nftAmountObj[tokenId];
		console.log("\n\n...: ", tokenId, tokenAmount);
		let [policyId, name] = tokenId.split(".");
		let strTokenAmount = commonUtilObj.number2String(tokenAmount);
		let bnTokenAmount = CardanoWasm.BigNum.from_str(strTokenAmount);

		let amountItem = {
			"unit": policyId,
			"name": name,
			"amount": bnTokenAmount.to_str()
		};
		transferAmount.push(amountItem);
	}

	return transferAmount;
}


function caculateUtxoPriorityByAssetMask(assetMask, formatUtxos) {
	console.log("..caculateUtxoPriorityByAssetMask assetMask: ", assetMask);

	let utxoPriorityAry = new Array();

	for (let i = 0; i < formatUtxos.length; i++) {

		let utxoPriority = 0;
		let mapUtxoAssetInfo = new Map();

		let utxoItem = formatUtxos[i];
		console.log("\n..caculateUtxoPriorityByAssetMask utxoItem: ", utxoItem);
		let utxoId = commonUtilObj.encodeUtxo(utxoItem).to_hex();

		let outputs = utxoItem.txOut;
		for (let j = 0; j < outputs.value.length; j++) {
			let itemAsset = outputs.value[j];
			let strItemAmount = itemAsset.quantity;
			// console.log("..caculateUtxoPriorityByAssetMask asset quantity: ", strItemAmount);

			// to check if asset type matched
			// console.log("..caculateUtxoPriorityByAssetMask asset type: ", itemAsset.unit);
			let strAssetAmount = assetMask.get(itemAsset.unit); // the unit takes no '.' 
			// console.log("..caculateUtxoPriorityByAssetMask asset amount: ", strAssetAmount);
			if (undefined !== strAssetAmount) {
				let amountPriority = 0;

				let bnAssetAmount = CardanoWasm.BigNum.from_str(strAssetAmount);
				let bnItemAmount = CardanoWasm.BigNum.from_str(strItemAmount);
				// console.log("..caculateUtxoPriorityByAssetMask amount: ", strAssetAmount, strItemAmount);
				// let ret = bnItemAmount.compare(bnAssetAmount);                    
				if (0 > bnItemAmount.compare(bnAssetAmount)) {
					amountPriority = parseInt(strItemAmount); // the amount is less than required amount                    
				} else {
					amountPriority = parseInt(strAssetAmount); // the amount satisfy required amount
				}

				// to count the priority of asset amount
				utxoPriority = utxoPriority + amountPriority;
				// console.log("..caculateUtxoPriorityByAssetMask utxoPriority: ", utxoPriority);
				// to statistic the related asset info of this utxo
				mapUtxoAssetInfo.set(itemAsset.unit, strItemAmount); // the unit takes no '.'

			}
		}

		if (0 < utxoPriority) {
			let utxoPriorityInfo = {
				"utxoId": utxoId,
				"nftInfos": mapUtxoAssetInfo,
				"priority": utxoPriority
			};
			console.log("..utxoPriorityInfo: ", utxoPriorityInfo);
			utxoPriorityAry.push(utxoPriorityInfo);
		}
	}

	return utxoPriorityAry;
}

function caculateNftUtxosPriority(formatUtxos, transferNftAmount) {
	// step 1: to generate asset mask based on transferNftAmount
	let mapAssetMask = commonUtilObj.genAssetMaskByAmount(transferNftAmount);

	// step 2: to caculate utxo priority based on assetMask
	let utxoPriorityAry = caculateUtxoPriorityByAssetMask(mapAssetMask, formatUtxos);

	// step 3: to sort the utxos by priority
	utxoPriorityAry.sort(commonUtilObj.compareByProperty("priority"));

	return utxoPriorityAry;
}

async function selectBalanceNftUtxos(totalUtxos, transferNftAmount) {

	let formatedUtxos = commonUtilObj.formatUtxoData(totalUtxos);;
	let selectedNftUtxos = new Array();

	// in case need to select more suitable utxo for balance
	let nftAmount = transferNftAmount;
	let marginNftAmount = undefined;
	do {
		console.log("....\navailable utxos collection length: ", formatedUtxos.length);
		console.log("....\n selected utxos length: ", selectedNftUtxos.length);
		if (MaxUtxoNum <= selectedNftUtxos.length) {
			marginNftAmount = nftAmount;
			break;
		}

		// to sort the nftAmount by amount
		nftAmount.sort(commonUtilObj.compareByProperty("amount"));
		console.log("\n\n\n\n..sorted nftAmount: ", nftAmount);

		// to get the best utxo with the top priority for nft balance
		let utxoPriorityAry = caculateNftUtxosPriority(formatedUtxos, nftAmount);
		let targetUtxoObj = utxoPriorityAry[0];
		console.log("\n\n\n\n..targetUtxoObj: ", targetUtxoObj);
		if (undefined === targetUtxoObj) {
			console.log("there is no utxo takes validy priority");
			return undefined;
		}

		// step 3:  udpate availableUtxos:  split this utxo away from array
		for (let j = 0; j < formatedUtxos.length; j++) {
			let utxoObj = formatedUtxos[j];
			let utxoId = commonUtilObj.encodeUtxo(utxoObj).to_hex();

			if (targetUtxoObj.utxoId === utxoId) {  
				console.log("there is fit utxo: ", utxoId, utxoObj);                  
				selectedNftUtxos.push(utxoObj);
				// remove this utxo from availableUtxos list
				formatedUtxos.splice(j, 1);
				break;
			}
		}
		console.log("selectedNftUtxos: ", selectedNftUtxos);

		// update nftAmount: 
		let tmpMarginNftAmount = commonUtilObj.caculateMarginNftAmount(nftAmount, targetUtxoObj);
		console.log("current MarginNftAmount: ", tmpMarginNftAmount);

		if (0 === tmpMarginNftAmount.length) {
			// has reached the transfer amount
			marginNftAmount = tmpMarginNftAmount;
			break;
		}
		nftAmount = tmpMarginNftAmount;

		await commonUtilObj.sleep(10000);

	} while (true);


	return selectedNftUtxos;
}


async function nftUtxoMerge(protocolParams, transferAmount, totalUtxos) {

	do {
		// in case of no suitable nft utxo
		let targetNftUtoxs = await selectBalanceNftUtxos(totalUtxos, transferAmount);
		if (undefined === targetNftUtoxs) {
			console.log("\n\n...selected Balance NftUtxos failed! ");
			break;
		}
		console.log("\n\n...selected Balance NftUtxos: ", targetNftUtoxs);
		// 	let ret = await handleNftUtxosBalance(internalSignFunc, targetNftUtoxs, transferAmount);
		// 	if (undefined === ret) {
		// 		throw "handle nft utxos merging failed for uniqueId: " + uniqueId;
		// 	}

		// let formatedUtxos = commonUtilObj.formatUtxoData(targetNftUtoxs);
		let ret = commonUtilObj.parseTreasuryNftUtxoChangeData(protocolParams, targetNftUtoxs, transferAmount, payAddress);
		console.log("\n\n...parseTreasuryNftUtxoChangeData ret: ", ret);
		console.log("...outputNum: ", ret.outputNum);
		console.log("...adaAmount: ", ret.adaAmount.to_str());
		console.log("...marginAda: ", ret.marginAda.to_str());
		console.log("...mergedBindAda: ", ret.mergedBindAda.to_str());
		console.log("...changedBindAda: ", ret.changedBindAda.to_str());
		console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n");

		await commonUtilObj.sleep(10000);

	} while (true);
}


async function trigerNFTUtxoMerge(protocolParams, totalUtxos, transferAmount){

	let nftAmountObj = buildMultiNftAmount(transferAmount);

	await nftUtxoMerge(protocolParams, nftAmountObj, totalUtxos);

}


async function main() {
	let ogmiosInst = buildOgmiosService();

	// to get protocolParams
	let protocolParams = await ogmiosInst.getCurrentProtocolParameters();
	// console.log("\n\n...getCurrentProtocolParameters ret: ", protocolParams);
	let minFeeA = JSON.stringify(protocolParams.minFeeCoefficient);
	let minFeeB = JSON.stringify(protocolParams.minFeeConstant);
	let coinsPerUtxoWord = JSON.stringify(protocolParams.coinsPerUtxoByte * 2);
	// console.log("\n\n...coinsPerUtxoWord ret: ", coinsPerUtxoWord);
	// console.log("...minFeeA ret: ", minFeeA);
	// console.log("...minFeeB ret: ", minFeeB);

	// to get utxos by address
	let pageNumber = 1;
	let countNumber = 100;
	let order = 'asc';
	let ret = await ogmiosInst.getAddressUTXOs(payAddress, pageNumber, countNumber, order);
	let totalUtxos = ret.utxos;
	console.log("\n\n...getAddressUTXOs ret: ", totalUtxos);

	// let commonUtilObj = new CommonUtils("addr_test");
	let formatedUtxos = convertUtxosFormat(totalUtxos);
	for (let i = 0; i < formatedUtxos.length; i++) {
		let utxoItem = formatedUtxos[i];
		let utxoValue = utxoItem.value;

		let adaAmount = utxoValue.coins;
		let assetAmount = utxoValue.assets;
		console.log("\n\n...utxo id: ", i);
		console.log("...utxo ada: ", adaAmount);
		console.log("...utxo asset: ", assetAmount);
	}


	let transferAmount = {
		"343ac71f7f3b2dbd4efa1e9735c2ac2cb7ae777d5325db23d9f77332.0014df10546573744e46543131": 3,
		"343ac71f7f3b2dbd4efa1e9735c2ac2cb7ae777d5325db23d9f77332.0014df10546573744e46543132": 19,
		"343ac71f7f3b2dbd4efa1e9735c2ac2cb7ae777d5325db23d9f77332.0014df10546573744e46543133": 23
	};
	await trigerNFTUtxoMerge(protocolParams, formatedUtxos, transferAmount);




}

main()
