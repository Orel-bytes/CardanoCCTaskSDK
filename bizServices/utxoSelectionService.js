const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const common = require('../util/common');
const coinSelection = require('../util/coinSelection');
const config = require('../config');

class UtxoSelectionService {

    constructor(addrPrefix) {

        this.commonUtil = new common(addrPrefix);
        this.coinSelectionInst = new coinSelection();
    }


    // add filter param of asset units
    filterAvailableUtxos(availableUtxos, value, bNFTMode = false) {
        // to static the asset units
        let filterUnits = new Array();
        for (let k = 0; k < value.length; k++) {
            let assetAmount = value[k];
            let assetUnit = assetAmount.unit
            if ("lovelace" !== assetUnit) {
                assetUnit = assetUnit + assetAmount.name;
            }
            let kIndex = filterUnits.indexOf(assetUnit);
            if (-1 === kIndex) {
                filterUnits.push(assetUnit);
            }
        }
        // console.log("\n..filterAvailableUtxos...filterUnits: ", bNFTMode, filterUnits);

        let selectionParam_inputs = new Array();
        for (let i = 0; i < availableUtxos.length; i++) {
            // to filter the utxo by asset unit
            let bAssetUnitMatched = true;
            let utxoValueArray = availableUtxos[i].txOut.value;
            for (let j = 0; j < utxoValueArray.length; j++) {
                let assetAmount = utxoValueArray[j];
                if (("lovelace" !== assetAmount.unit) && (-1 === filterUnits.indexOf(assetAmount.unit))) {
                    bAssetUnitMatched = false;
                    if (!bNFTMode) {
                        break;
                    }
                }

                if (("lovelace" !== assetAmount.unit) && (-1 !== filterUnits.indexOf(assetAmount.unit))) {
                    bAssetUnitMatched = true;
                    if (bNFTMode) {
                        break;
                    }
                }
            }

            if (bAssetUnitMatched) {
                // console.log("\n..filterAvailableUtxos...selected_input: ", availableUtxos[i]);
                let encUtxoObj = this.commonUtil.encodeUtxo(availableUtxos[i]);
                selectionParam_inputs.push(encUtxoObj);
            }
        }

        return selectionParam_inputs;
    }

    setProtocolParameters(coinsPerUtxoByte, minFeeA, minFeeB, maxTxSize = '10000') {
        this.coinSelectionInst.setProtocolParameters(coinsPerUtxoByte, minFeeA, minFeeB, maxTxSize);
    }

    selectUtxos(utxos, toAddress, value, limit, bNFTMode = false) {
        console.log("\n\n...selectUtxos limit: ", limit);

        if (undefined === limit) {
            limit = config.PlutusCfg.leaderUtxoNumLimit;
        }

        // step 1: to build output params
        let outputAddress = CardanoWasm.Address.from_bech32(toAddress);
        let outputValue = this.commonUtil.buildOutputValue(value, undefined, this.coinsPerUtxoWord);
        let txOutput = CardanoWasm.TransactionOutput.new(outputAddress, outputValue);

        let selectionParam_outputs = CardanoWasm.TransactionOutputs.new();
        selectionParam_outputs.add(txOutput);

        // step 2: to filter available utxo and build input params
        let selectedUtxos = new Array();
        let selectionParam_inputs = this.filterAvailableUtxos(utxos, value, bNFTMode);
        // console.log("..UtxoSelectionService......filterAvailableUtxos inputs len: ", selectionParam_inputs.length);
        if (0 === selectionParam_inputs.length) {
            return selectedUtxos;

        } else {

            try {
                console.log("..UtxoSelectionService selectUtxos......try to select utxos limited by 1 !");
                let selectedRet = this.coinSelectionInst.randomImprove(selectionParam_inputs,
                    selectionParam_outputs,
                    1,
                    outputAddress); // the 3rd param should be changed into 20+tokenAssets

                for (let i = 0; i < selectedRet.input.length; i++) {
                    let utxo = selectedRet.input[i];
                    let utxoInfoObj = this.commonUtil.decodeUtxo(utxo);

                    selectedUtxos.push(utxoInfoObj);
                }
                console.log("..UtxoSelectionService selectUtxos randomImprove:", selectedUtxos);

            } catch (e) {
                console.log("..UtxoSelectionService selectUtxos.select by limit 1 failed! retry by default limit: ", limit);
                try {
                    let selectedRet = this.coinSelectionInst.randomImprove(selectionParam_inputs,
                        selectionParam_outputs,
                        limit,
                        outputAddress); // the 3rd param should be changed into 20+tokenAssets

                    for (let i = 0; i < selectedRet.input.length; i++) {
                        let utxo = selectedRet.input[i];
                        let utxoInfoObj = this.commonUtil.decodeUtxo(utxo);

                        selectedUtxos.push(utxoInfoObj);
                    }
                    console.log("..UtxoSelectionService......selectUtxos randomImprove:", selectedUtxos.length);

                } catch (error) {
                    console.log("..UtxoSelectionService......selectUtxo warning : INPUTS EXHAUSTED!");
                    return selectedUtxos;
                }
            }
        }

        return selectedUtxos;
    }

}


module.exports = UtxoSelectionService;
