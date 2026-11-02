const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const common = require('../util/common');
const config = require('../config');

class UtxoSplitService {

    constructor(addrPrefix) {

        this.commonUtil = new common(addrPrefix);
    }

    setCurBalanceParams(balancedParams) {
        if (undefined === balancedParams) {
            return false;
        }
        this.curBalancedParams = balancedParams;
        return true;
    }

    checkInputUtxosSplitTreshold(assetUnit, totalUtxos, inputUtxos, outputNum) {
        // to format utxos to caculate token amount of input utxos      
        let formatTotalUtxos = this.commonUtil.formatUtxoData(totalUtxos);
        let bnTotalAssetAmount = this.commonUtil.caculateTotalAmountByAssetUnit(formatTotalUtxos, assetUnit);

        let formatInputUtxos = this.commonUtil.formatUtxoData(inputUtxos);
        let bnInputAssetAmount = this.commonUtil.caculateTotalAmountByAssetUnit(formatInputUtxos, assetUnit);

        // to caculate the theoretical minOutput token amount in split operation 
        let idealNum = this.curBalancedParams.balancedCfg.utxoNumThresheld.idealUtxoListLen;
        let strIdealNum = this.commonUtil.number2String(idealNum);
        let bnIdealNum = CardanoWasm.BigNum.from_str(strIdealNum);
        let idealAvaValue = bnTotalAssetAmount.div_floor(bnIdealNum);

        let strOutPutNum = this.commonUtil.number2String(outputNum);
        let bnOutputNum = CardanoWasm.BigNum.from_str(strOutPutNum);
        let bnMinIutputValue = idealAvaValue.checked_mul(bnOutputNum)

        // to check if the actural value is more than theoretical value
        if (bnInputAssetAmount.less_than(bnMinIutputValue)) {
            return false;
        }
        return true;
    }

    checkAssetAmountSplitTreshold(assetUnit, totalUtxos) {
        let formatedUtxos = this.commonUtil.formatUtxoData(totalUtxos);
        let totalAssetAmount = this.commonUtil.caculateTotalAmountByAssetUnit(formatedUtxos, assetUnit);

        // to check asset total amount if match assetAmountThresheld in balanced config   
        let strTresheldAmount = this.curBalancedParams.balancedCfg.assetAmountThresheld[assetUnit.replace(".", "")];
        if (undefined === strTresheldAmount) {
            return false;
        }

        let splitTresheldAmount = CardanoWasm.BigNum.from_str(strTresheldAmount);
        if (totalAssetAmount.less_than(splitTresheldAmount)) {
            return false;
        }
        return true;
    }

    confirmUtxoSplitCondition(assetUnit, totalUtxos, inputUtxos) {
        // // to set asset balanced direction to split
        // this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Split);

        // should also consider the token split threshold in this case           
        let bCheckRet = this.checkAssetAmountSplitTreshold(assetUnit, totalUtxos);
        if (!bCheckRet) {
            return undefined;
        }

        // to adjust output utxos num
        let adjustedOutputNum = (config.PlutusCfg.maxUtxoNum === inputUtxos.length) ?
            (config.BalancedCfg.minSpitedUtxoNum + 1) : config.BalancedCfg.minSpitedUtxoNum;

        // to check if input token amount matchs the split threshold
        bCheckRet = this.checkInputUtxosSplitTreshold(assetUnit, totalUtxos, inputUtxos, adjustedOutputNum);
        if (!bCheckRet) {
            return undefined;
        }

        // to return adjusted confirm result
        let ret = {
            "coordinateUtxos": inputUtxos,
            "outputNum": adjustedOutputNum  // config.BalancedCfg.minSpitedUtxoNum //
        }
        return ret;
    }

}


module.exports = UtxoSplitService;
