
const contracts = require('../cross-chain-js/contracts');
const cardanoClient = require("./CardanoApiOgmios");
const common = require("../util/common");
const WanOgmiosApi = require("./wanOgmiosApi");
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');



class CheckToken {
    constructor(){
    }

    async init(){


        contracts.init(false);
        this.validCheckTokenPolicyId = contracts.TreasuryCheckTokenScript.policy_id();
        console.log("\n\n validCheckTokenPolicyId: ", this.validCheckTokenPolicyId);
        this.validMappingCheckTokenPolicyId = contracts.MintCheckTokenScript.policy_id();
        console.log("validMappingCheckTokenPolicyId: ", this.validMappingCheckTokenPolicyId);

        this.commonUtil = new common("addr_test");

        let optionCfg = {
            "host": "http://52.13.9.234",
            "port": "4337"
        }
        this.cardanoClient = new cardanoClient(optionCfg);
    }

    async getCheckTokenUtxos(){
        const checkScriptAddress = "addr_test1xph67xfscczu2xccnryv59favadg6wzhatqzltssmfvduj6wsw5k2ttkze7e9zd3jr00x5nkhmpx97cv6xx25jsgxh2snm3zu0";

        let ret = await this.cardanoClient.getAddressUTXOsWithBlockHeight(checkScriptAddress, 1, 100);
        let utxos = new Array();
        for(let i=0; i<ret.utxos.length; i++){
            let utxo = ret.utxos[i];
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
                    // this.logger.debug("..PlutusTxBuilder......asset unit: ", utxo.amount[j].unit, utxo.amount[j].quantity + '')
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

            utxos.push({
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
        console.log("\n\n checkScript utxos number: ", utxos.length);

        let formatedUtxos = this.commonUtil.formatUtxoData(utxos);
        console.log("\n\n checkScript formatedUtxos len: ", formatedUtxos.length);

        return formatedUtxos;
    }


    fiterValidCheckTokenUtxos(formatUtxos) {
        let validCheckTokenUtxos = new Array();
        for (let i = 0; i < formatUtxos.length; i++) {

            let utxoItem = formatUtxos[i];
            let bValid = this.parseCheckTokenValidity(utxoItem);
            if (bValid) {
                validCheckTokenUtxos.push(utxoItem);
            }
        }
        // console.log("\n\n checkScript valid Utxos: ", validCheckTokenUtxos);
        return validCheckTokenUtxos;
    }

    parseCheckTokenValidity(formatUtxo) {

        let bContainCheckToken = false;

        let txOutData = formatUtxo.txOut;
        if (1 === txOutData.value.length) {
            // in case there is just ada asset
            return false;
        }

        for (let i = 1; i < txOutData.value.length; i++) {
            if ("lovelace" === txOutData.value[i].unit) {
                continue;
            }

            let tokenPolicyId = txOutData.value[i].unit.slice(0, 56);
            if ((this.validCheckTokenPolicyId === tokenPolicyId)
                || (this.validMappingCheckTokenPolicyId === tokenPolicyId)) {
                console.log("..parseCheckTokenValidity...tokenPolicyId: ", tokenPolicyId);
                bContainCheckToken = true;
                break;
            }
        }

        return bContainCheckToken;
    }



}

async function main(){

    let checkTokenInst = new CheckToken();
    checkTokenInst.init();

    let totalUtxos = await checkTokenInst.getCheckTokenUtxos();

    let validCheckTokenUtxos = checkTokenInst.fiterValidCheckTokenUtxos(totalUtxos);
    if ((undefined === validCheckTokenUtxos) || (validCheckTokenUtxos.length < 1)) {
        console.log("..fiterValidCheckTokenUtxos...warning: no valid check utxo");
        return undefined;
    }


    let txId = validCheckTokenUtxos[0].txIn.txId;
    console.log("\n\n..fiterValidCheckTokenUtxos...txId: ", txId);
    let txIndex = validCheckTokenUtxos[0].txIn.index;
    console.log("..fiterValidCheckTokenUtxos...txIndex: ", txIndex);


}

main();