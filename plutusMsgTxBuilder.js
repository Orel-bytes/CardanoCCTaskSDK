const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const msgContracts = require('./cross-chain-js/msg-contract');
const contractsMgr = require('./cross-chain-js/contracts-mgr');
const utils = require('./cross-chain-js/utils');
const plutusdata = require('./cross-chain-js/plutusdata');
const common = require('./util/common');
const config = require('./config');
const cbor = require('cbor-sync');

const LEADER_FEE_AMOUNT = "5000000";

class plutusMsgTxBuilder {

    constructor(chainConnector, coinSelectionInst, scriptRefOwnerAddr, logUtil, bMainnet) {
        this.connector = chainConnector;
        this.coinSelectionInst = coinSelectionInst;
        this.scriptRefOwnerAddr = scriptRefOwnerAddr;
        // this.collateralAmount = config.PlutusCfg.collateralAmount;
        this.bMainnet = bMainnet;

        this.ADDR_PREFIX = config.PlutusCfg.testnetPrefix;
        this.network_id = CardanoWasm.NetworkInfo.testnet_preprod().network_id();
        if (bMainnet) {
            this.ADDR_PREFIX = config.PlutusCfg.mainnetPrefix;
            this.network_id = CardanoWasm.NetworkInfo.mainnet().network_id();
        }
        this.maxPlutusUtxoNum = config.PlutusCfg.maxUtxoNum;
        this.signMode = config.SignAlgorithmMode;

        msgContracts.init(bMainnet);

        this.coinsPerUtxoWord = undefined;
        this.coinsPerUtxoByte = undefined;
        this.minFeeA = undefined;
        this.minFeeB = undefined;
        this.protocolParams = undefined;

        // to record the current gpk
        this.curChainTip = undefined;
        this.curLatestBlock = undefined;
        this.groupPK = undefined;
        // to record pending consumed utxos
        this.mapPendingConsumedUTXO = new Map();
        // this.mapMultiAssetUTXO = new Map(); 
        // this.mapScBalancedMarkRecord = new Map();
        // this.mapForcedBalancedStatus = new Map();

        this.mapAddressAvailableUtxos = new Map();
        this.mapAccountLocker = new Map();

        // supportted token 
        // this.mapValidAssetType = new Map();
        // this.mapBalancedDirection = new Map();
        // this.mapAssetBalancedTs = new Map();
        // this.mapAssetAdaSptrippedTs = new Map();

        // to new common util instance
        this.commonUtil = new common(this.ADDR_PREFIX);
        this.logger = logUtil;

        this.validCheckTokenPolicyId = msgContracts.InboundCheckTokenScript.policy_id();
        // this.validMappingCheckTokenPolicyId = contracts.MintCheckTokenScript.policy_id();
        
        this.memScriptRefUtxos = new Array();
    }

    init() {       

        return true;
    }

    getValidCheckTokenPolicyId() {        
        return this.validCheckTokenPolicyId;
    }

    addressToPkhOrScriptHash(address) {
        let phk = utils.addressToPkhOrScriptHash(address);
        return phk;
    }

    async convertSlotToTimestamp(slot) {
        try {
            const eraSummaries = await this.connector.queryEraSummaries();
            const genisis = await this.connector.queryGenesisConfig();

            return this.slotToTimestamp(slot, eraSummaries, genisis);

        } catch (err) {
            throw `convertSlotToTimestamp failed:  ${err}`;
        }
    }

    slotToTimestamp(slot, eraSummaries, genisis) {

        let earIndexNumber = undefined;
        for (let i = 0; i < eraSummaries.length; i++) {
            const ear = eraSummaries[i];
            if ((slot >= ear.start.slot) && (slot <= ear.end.slot)) {
                earIndexNumber = i;
                break;
            } else if (slot > ear.end.slot) {
                continue;
            } else if (slot < ear.end.slot) {
                throw `Bad slot ${slot}`;
            }
        }

        if (undefined === earIndexNumber) {
            throw `Bad slot ${slot}`;
        }

        let sysStartTimeStamp = Date.parse(genisis.systemStart);
        const targetEar = eraSummaries[earIndexNumber];
        return sysStartTimeStamp + targetEar.start.time * 1000 + (slot - targetEar.start.slot) * targetEar.parameters.slotLength * 1000;
    }

    async updateGroupInfoToken() {
        let tmpGroupInfoToken = await this.getGroupInfoToken();
        // this.logger.debug("..plutusMsgTxBuilder......updateGroupInfoToken..groupInfoToken: ", groupInfoToken);
        if (false === tmpGroupInfoToken) {
            this.logger.debug("..plutusMsgTxBuilder......failed to get groupInfoToken: ");
            return false;
        } else {
            this.groupInfoToken = tmpGroupInfoToken;
        }

        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
        return true;
    }

    async getCurChainParams() {
        let latestChainTip = undefined;
        try {
            latestChainTip = await this.connector.chainTip();
            // this.logger.debug("..plutusMsgTxBuilder......latestChainTip: ", latestChainTip);
        } catch (e) {
            this.logger.debug("..plutusMsgTxBuilder......failed to get chainTip: ", e);
            return false;
        }

        // step 2: to get lock 
        if ((undefined !== this.curChainTip)
            && ((this.curChainTip.slot + config.ChainStatusValidLatestSlot) > latestChainTip.slot)) {
            return true;
        }

        while (this.mapAccountLocker.get("latestChainStatusLocker")) {
            await this.commonUtil.sleep(1000);
        }

        this.mapAccountLocker.set("latestChainStatusLocker", true);

        if ((undefined === this.curChainTip)
            || ((this.curChainTip.slot + config.ChainStatusValidLatestSlot) <= latestChainTip.slot)) {
            try {
                // to filter utxos in security block scopes
                this.curLatestBlock = await this.connector.blocksLatest();
                // this.logger.debug("..plutusMsgTxBuilder......this.curLatestBlock: ", this.curLatestBlock);
            } catch (e) {
                this.logger.debug("..plutusMsgTxBuilder......get blocksLatest failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                let tmpProtocolParams = await this.connector.getCurrentProtocolParameters();
                // this.logger.debug("..plutusMsgTxBuilder......protocolParams: ", this.protocolParams);
                if ((undefined === tmpProtocolParams) || ("" === tmpProtocolParams)) {
                    this.logger.debug("..plutusMsgTxBuilder......getCurChainParams failed: ");
                    this.mapAccountLocker.set("latestChainStatusLocker", false);
                    return false;
                }

                this.protocolParams = tmpProtocolParams;
                this.minFeeA = JSON.stringify(this.protocolParams.minFeeCoefficient);
                this.minFeeB = JSON.stringify(this.protocolParams.minFeeConstant);
                this.coinsPerUtxoWord = JSON.stringify(this.protocolParams.coinsPerUtxoByte * 2);
                this.coinsPerUtxoByte = JSON.stringify(this.protocolParams.coinsPerUtxoByte);
                this.maxTxSize = JSON.stringify(this.protocolParams.maxTxSize);

                const v1 = CardanoWasm.CostModel.new();
                let index = 0;
                for (let i = 0; i < this.protocolParams.plutusCostModels["plutus:v1"].length; i++) {
                    v1.set(index, CardanoWasm.Int.new_i32(this.protocolParams.plutusCostModels["plutus:v1"][i]));
                    index++;
                }

                const v2 = CardanoWasm.CostModel.new();
                index = 0;
                for (let j = 0; j < this.protocolParams.plutusCostModels["plutus:v2"].length; j++) {
                    v2.set(index, CardanoWasm.Int.new_i32(this.protocolParams.plutusCostModels["plutus:v2"][j]));
                    index++;
                }

                const v3 = CardanoWasm.CostModel.new();
                index = 0;
                for (let k = 0; k < this.protocolParams.plutusCostModels["plutus:v3"].length; k++) {
                    v3.set(index, CardanoWasm.Int.new_i32(this.protocolParams.plutusCostModels["plutus:v3"][k]));
                    index++;
                }
                this.protocolParams.costModels = CardanoWasm.Costmdls.new();
                this.protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v1(), v1);
                this.protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v2(), v2);
                this.protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v3(), v3);

            } catch (e) {
                this.logger.debug("..plutusMsgTxBuilder......getCurChainParams failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                this.curChainTip = await this.connector.chainTip();
                this.logger.debug("..plutusMsgTxBuilder......get this.curChainTip onchain: ", this.curChainTip);

            } catch (e) {
                this.logger.debug("..plutusMsgTxBuilder......get chainTip failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

        }

        this.mapAccountLocker.set("latestChainStatusLocker", false);
        return true;
    }

    async getUtxo(address, bCheckDatum = true, coinValue = 0) {
        const itemCount = 100;
        let pageNumber = 1;
        let utxos = new Array();
        let ret = new Array();
        let safeBlockNumber = 0;
        // this.logger.debug("..plutusMsgTxBuilder......getUtxo address: ", address, bCheckDatum);

        //if (undefined === this.curChainTip) {
        try {
            let rslt = await this.getCurChainParams();
            if (false === rslt) {
                this.logger.debug("..plutusMsgTxBuilder...getUtxo...getCurChainParams: ", rslt);
                return ret;
            }

        } catch (e) {
            this.logger.debug("..plutusMsgTxBuilder...getUtxo...getCurChainParams failed: ", e);
            return ret;
        }
        //}

        // to check if need to query from ogmios service
        let utxoRecordObj = this.mapAddressAvailableUtxos.get(address);
        if ((undefined !== utxoRecordObj)
            && (utxoRecordObj.recordSlot > (this.curChainTip.slot - config.UtxoValidLatestSlot))) {
            // pre-backup utxo is still valid
            //this.logger.debug("..plutusMsgTxBuilder......getUtxo...utxoRecordObj.utxos: ", utxoRecordObj.utxoRecords);
            return utxoRecordObj.utxoRecords;

        } else {
            // step 2: to check safe block height            
            while (this.mapAccountLocker.get(address)) {
                await this.commonUtil.sleep(1000);
            }
            this.mapAccountLocker.set(address, true);

            let curUtxoRecord = this.mapAddressAvailableUtxos.get(address);
            if (((undefined === utxoRecordObj) && (undefined !== curUtxoRecord))
                || ((undefined !== utxoRecordObj) && (utxoRecordObj.recordSlot !== curUtxoRecord.recordSlot))) {

                this.mapAccountLocker.set(address, false);
                return curUtxoRecord.utxoRecords;
            }

            // add exception catch for connector
            try {
                do {
                    let rslt = await this.connector.getAddressUTXOsWithBlockHeight(address, pageNumber, itemCount, 'asc');
                    // console.log("\n\n getAddressUTXOsWithBlockHeight... rslt: ", rslt);
                    // this.logger.debug(`..plutusMsgTxBuilder...getAddressUTXOsWithBlockHeight ${address}...${rslt.utxos}`);        
                    if (null == rslt) {
                        break;
                    } else {
                        utxos.push(...rslt.utxos);
                    }

                    if ("ogmios" === rslt.source) {
                        break;
                    } else if (itemCount > rslt.utxos.length) {
                        break;
                    } else {
                        pageNumber++;
                    }

                } while (true);

            } catch (e) {
                this.logger.debug("..plutusMsgTxBuilder......getUtxo...getAddressUTXOs failed: ", e);
                this.mapAccountLocker.set(address, false);
                return ret;
            }
        }
        // this.logger.debug(`..plutusMsgTxBuilder...getUtxo return ${utxos.length} utxo of ${address}`);

        // step 3: to filter safe utxos
        // 2023/06/27 modify: to filter safe utxos in wanOgmiosService api
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
                    // this.logger.debug("..plutusMsgTxBuilder......asset unit: ", utxo.amount[j].unit, utxo.amount[j].quantity + '')
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
            let utxoDatum = this.connector.bUseOgmios ? utxo.data_hash : utxo.inline_datum;
            // this.logger.debug("..plutusMsgTxBuilder......utxo utxoDatum: ", bCheckDatum, utxo.data_hash)
            if ((bCheckDatum && utxoDatum) || (!bCheckDatum)) {
                ret.push({
                    txHash: utxo.tx_hash,
                    index: utxo.tx_index,
                    value: {
                        coins: coinsAmount,
                        assets: mapAsset
                    },
                    address: utxo.address,
                    datum: utxoDatum,
                    datumHash: utxo.datumHash,
                    script: utxo.script,
                    blockHeight: utxo.blockHeight
                });
            }
        }

        let newUtxoRecordObj = {
            "utxoRecords": ret,
            "recordSlot": this.curChainTip.slot
        }
        this.mapAddressAvailableUtxos.set(address, newUtxoRecordObj);
        this.mapAccountLocker.set(address, false);

        // this.logger.debug("..plutusMsgTxBuilder......ret len: ", ret.length);
        return ret;
    }

    async getGroupInfoToken() {
        const groupInfoHolder = contractsMgr.GroupInfoNFTHolderScript.address().to_bech32(this.ADDR_PREFIX);
        this.logger.debug("..plutusMsgTxBuilder......GroupInfoNFTHolderScript address: ", groupInfoHolder);

        let expectedTokenId = contractsMgr.GroupNFT.tokenId(); // need liulin confirm
        expectedTokenId = expectedTokenId.replace(".", "")
        const groupInfoToken = (await this.getUtxo(groupInfoHolder)).find(o => {
            for (let tokenId in o.value.assets) {
                tokenId = tokenId.replace(".", "");
                if (tokenId == expectedTokenId) return true;
            }
            return false;
        });
        //this.logger.debug("..plutusMsgTxBuilder......groupInfoToken ", groupInfoToken);
        if (undefined === groupInfoToken) {
            return false;
        }
        return groupInfoToken;
    }

    async buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs) {
        this.logger.debug("..plutusMsgTxBuilder...buildSignedTx......basicArgs:", basicArgs);
        this.logger.debug("..plutusMsgTxBuilder...", basicArgs.hashX, "...begin to build Signed Tx! ");
        this.paymentAddress = basicArgs.paymentAddress;
        this.paymentSkey = basicArgs.paymentSKey;

        //Step 1: to get groupInfoToken and fetch group pk
        let encodedGpk = this.commonUtil.encodeGpk(basicArgs.gpk);
        // this.logger.debug("..plutusMsgTxBuilder...", basicArgs.hashX, "...this.groupInfoToken: ", this.groupInfoToken);
        if (this.groupPK !== encodedGpk) {
            let tmpGroupInfoToken = await this.getGroupInfoToken();
            if (false === tmpGroupInfoToken) {
                throw "exception network during get group info token";
            } else {
                this.groupInfoToken = tmpGroupInfoToken;
            }

            const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
            //this.logger.debug("..plutusMsgTxBuilder...", basicArgs.hashX, "...groupInfoFromDatum...groupInfo: ", groupInfo);
            this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
            this.logger.debug("..plutusMsgTxBuilder...", basicArgs.hashX, "...groupInfoFromDatum...groupPK: ", this.groupPK);

            if (this.groupPK !== encodedGpk) {
                throw "inconsistent gpk";
            }
        }
        console.log("\n\n... this.groupPK: ", this.groupPK);

        // Step 2: to get cardano current netParams
        let bRet = await this.getCurChainParams();
        // this.logger.debug("..plutusMsgTxBuilder...", basicArgs.hashX, "...getCurChainParams......bRet:", bRet);
        if (false === bRet) {
            throw "exception network during update protocal params";
        }

        // Step 3: to build cardano cross-chain tx
        let signedTx = await this.buildAndSignMsgRawTx(basicArgs, partialRedeemerArgs, internalSignFunc);
        this.logger.debug("..plutusMsgTxBuilder...", basicArgs.hashX, "...buildAndSignMsgRawTx......signedTx:", signedTx);
        return signedTx;
    }

    // add filter param of asset units
    filterAvailableUtxos(availableUtxos, value) {
        // this.logger.debug("..plutusMsgTxBuilder......filterAvailableUtxos value: ", value);
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

        let selectionParam_inputs = new Array();
        //this.logger.debug("..plutusMsgTxBuilder......filterAvailableUtxos... utxo pool: ", availableUtxos);
        for (let i = 0; i < availableUtxos.length; i++) {

            // to filter the utxo by asset unit
            let bAssetUnitMatched = true;
            let utxoValueArray = availableUtxos[i].txOut.value;
            for (let j = 0; j < utxoValueArray.length; j++) {
                let assetAmount = utxoValueArray[j];
                if (("lovelace" !== assetAmount.unit) && (-1 === filterUnits.indexOf(assetAmount.unit))) {
                    bAssetUnitMatched = false;
                    break;
                }
            }

            if (bAssetUnitMatched) {
                let encUtxoObj = this.commonUtil.encodeUtxo(availableUtxos[i]);
                selectionParam_inputs.push(encUtxoObj);
            }
        }

        // this.logger.debug("..plutusMsgTxBuilder......filterAvailableUtxos... filtered utxo: ", selectionParam_inputs);
        return selectionParam_inputs;
    }

    selectUtxos(utxos, toAddress, value, limit) {
        if (undefined === limit) {
            limit = config.PlutusCfg.leaderUtxoNumLimit;
        }

        this.coinSelectionInst.setProtocolParameters(this.coinsPerUtxoByte, this.minFeeA, this.minFeeB, '10000');
        // this.logger.debug("..plutusMsgTxBuilder......selectUtxos toAddress: ", toAddress);

        // step 1: to build output params
        // this.logger.debug("..plutusMsgTxBuilder......buildOutputValue value: ", value);
        let outputAddress = CardanoWasm.Address.from_bech32(toAddress);
        // this.logger.debug("..plutusMsgTxBuilder......outputAddress: ", outputAddress);
        let outputValue = this.commonUtil.buildOutputValue(value, undefined, this.coinsPerUtxoWord);
        // this.logger.debug("..plutusMsgTxBuilder......buildOutputValue ret: ", outputValue);
        let txOutput = CardanoWasm.TransactionOutput.new(outputAddress, outputValue);
        // this.logger.debug("..plutusMsgTxBuilder......TransactionOutput ret: ", txOutput);

        let selectionParam_outputs = CardanoWasm.TransactionOutputs.new();
        selectionParam_outputs.add(txOutput);

        // step 2: to filter available utxo and build input params
        let selectedUtxos = new Array();
        let selectionParam_inputs = this.filterAvailableUtxos(utxos, value);
        // this.logger.debug("..plutusMsgTxBuilder......filterAvailableUtxos inputs len: ", selectionParam_inputs.length);
        if (0 === selectionParam_inputs.length) {
            return selectedUtxos;

        } else {

            try {
                this.logger.debug("..plutusMsgTxBuilder......try to select utxos limited by 1 !");
                let selectedRet = this.coinSelectionInst.randomImprove(selectionParam_inputs,
                    selectionParam_outputs,
                    1,
                    outputAddress); // the 3rd param should be changed into 20+tokenAssets

                for (let i = 0; i < selectedRet.input.length; i++) {
                    let utxo = selectedRet.input[i];
                    let utxoInfoObj = this.commonUtil.decodeUtxo(utxo);

                    selectedUtxos.push(utxoInfoObj);
                }
                // this.logger.debug("..plutusMsgTxBuilder......selectUtxos randomImprove:", selectedUtxos);

            } catch (e) {
                this.logger.debug("..plutusMsgTxBuilder......select by limit 1 failed! retry by default limit: ", limit);
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
                    // this.logger.debug("..plutusMsgTxBuilder......selectUtxos randomImprove:", selectedUtxos.length);

                } catch (error) {
                    this.logger.debug("..plutusMsgTxBuilder......selectUtxo warning : INPUTS EXHAUSTED!");
                    return selectedUtxos;
                }
            }
        }

        return selectedUtxos;
    }

    checkAvailableUtxos(payAddress, utxos, bCheckUtxoAddress, assetUnit = undefined) {
        // Step1: to format utxos
        let formatUtxos = this.commonUtil.formatUtxoData(utxos);

        // Step2: to filter multi-asset utxos
        let availableUtxos = new Array();
        for (let k = 0; k < formatUtxos.length; k++) {
            let mapAssetUnit = new Map();
            let itemTxOut = formatUtxos[k].txOut;
            for (let v = 0; v < itemTxOut.value.length; v++) {
                let itemValue = itemTxOut.value[v];
                mapAssetUnit.set(itemValue.unit, true);
                // this.logger.debug("..plutusMsgTxBuilder......mapAssetUnit set :", itemValue.unit, assetUnit);
            }

            // to filter multi-asset utxos
            //this.logger.debug("..plutusMsgTxBuilder......mapAssetUnit size :", mapAssetUnit.size);
            if (2 >= mapAssetUnit.size) {
                if (!assetUnit) {
                    availableUtxos.push(formatUtxos[k]);
                } else if (("lovelace" === assetUnit) && (1 === mapAssetUnit.size)) {
                    availableUtxos.push(formatUtxos[k]);
                } else if (("lovelace" !== assetUnit) && (mapAssetUnit.get(assetUnit.replace(".", "")))) {
                    availableUtxos.push(formatUtxos[k]);
                }
            }
        }
        this.logger.debug("..plutusMsgTxBuilder......availableUtxos length:", payAddress, assetUnit, availableUtxos.length);

        // Step3: to filter pending consumed utxo
        let filteredAvailableUtxos = undefined;
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(payAddress);
        if (undefined === mapConsumedUtxos) {
            filteredAvailableUtxos = availableUtxos;

            mapConsumedUtxos = new Map();
            this.mapPendingConsumedUTXO.set(payAddress, mapConsumedUtxos);

        } else {
            // Step3-1: to update pending consumed utxos 
            let maxPendingTTL = bCheckUtxoAddress ? config.MaxConsumedCheckUtxoTTL : config.MaxConsumedUtxoTTL;

            for (let key of mapConsumedUtxos.keys()) {
                let consumedInitialSlot = mapConsumedUtxos.get(key);
                let durSlot = this.curChainTip.slot - consumedInitialSlot;
                if (maxPendingTTL <= durSlot) {
                    mapConsumedUtxos.delete(key);
                }

                this.mapPendingConsumedUTXO.set(payAddress, mapConsumedUtxos);
            }

            // Step3-2:  to filter pending consumed utxo
            for (let i = 0; i < availableUtxos.length; i++) {
                // this.logger.debug("..plutusMsgTxBuilder......filteredAvailableUtxos...available Utxo:", i, availableUtxos[i]);
                let encUtxo = this.commonUtil.encodeUtxo(availableUtxos[i]);
                let utxoId = encUtxo.input().to_hex();
                let consumedInitialSlot = mapConsumedUtxos.get(utxoId);
                if (undefined !== consumedInitialSlot) {
                    // this.logger.debug("..plutusMsgTxBuilder......filteredAvailableUtxos...consumedInitialSlot:",availableUtxos[i], utxoId, consumedInitialSlot, this.curChainTip.slot);
                    continue;
                }

                // confirm available utxos
                if (undefined === filteredAvailableUtxos) {
                    filteredAvailableUtxos = new Array();
                }
                filteredAvailableUtxos.push(availableUtxos[i]);
                // this.logger.debug("..plutusMsgTxBuilder......filteredAvailableUtxos...:", i, availableUtxos[i], utxoId);
            }
        }

        this.logger.debug("..plutusMsgTxBuilder......filteredAvailableUtxos :", payAddress);
        return filteredAvailableUtxos;
    }

    async getScriptCheckRefAvailableUtxo(scriptCheckRefAddress) {

        let utxos = await this.getUtxo(scriptCheckRefAddress, false);
        this.logger.debug("..plutusMsgTxBuilder......get scriptCheckRef utxos: ", scriptCheckRefAddress, utxos.length);
        if (0 === utxos.length) {
            this.logger.debug("..plutusMsgTxBuilder.....warning: get no scriptCheckRef utxos.");
            return undefined;
        }

        let availableUtxos = this.checkAvailableUtxos(scriptCheckRefAddress, utxos, true);
        // this.logger.debug("..plutusMsgTxBuilder......availableUtxos: ", availableUtxos);
        if ((undefined === availableUtxos) || (availableUtxos.length < 1)) {
            this.logger.debug("..plutusMsgTxBuilder...getScriptCheckRefAvailableUtxo...warning: no available check utxo");
            return undefined;
        }

        // to filte the valid check token utxos with the valid policyId
        let validCheckTokenUtxos = this.fiterValidCheckTokenUtxos(availableUtxos);
        if ((undefined === validCheckTokenUtxos) || (validCheckTokenUtxos.length < 1)) {
            this.logger.debug("..plutusMsgTxBuilder...getScriptCheckRefAvailableUtxo...warning: no valid check utxo");
            return undefined;
        }

        let treasuryCheckUxto = undefined; // availableTreasuryCheckUxto

        let txId = validCheckTokenUtxos[0].txIn.txId;
        let txIndex = validCheckTokenUtxos[0].txIn.index;
        for (let k = 0; k < utxos.length; k++) {
            let utxo = utxos[k];
            if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                treasuryCheckUxto = utxo;
                // this.logger.debug("..plutusMsgTxBuilder......selected validCheckTokenUtxos: ", utxo);

                // to add new pending consumed utxos for scriptCheckRefAddress
                let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(scriptCheckRefAddress);
                if (undefined === mapConsumedUtxos) {
                    mapConsumedUtxos = new Map();
                }
                let encUtxo = this.commonUtil.encodeUtxo(validCheckTokenUtxos[0]);
                let utxoId = encUtxo.input().to_hex();
                mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                this.mapPendingConsumedUTXO.set(scriptCheckRefAddress, mapConsumedUtxos);

                break;
            }
        }

        return treasuryCheckUxto;
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
            if (this.validCheckTokenPolicyId === tokenPolicyId){
                bContainCheckToken = true;
                break;
            }
        }

        return bContainCheckToken;
    }

    async getUtxoOfAmount(payAddress, toAddress, amount, limit) {
        // to verify the amount validity
        if ((undefined === amount) || (0 === amount.length)) {
            return undefined;
        }
        let assetUnit = ("lovelace" === amount[0].unit) ? "lovelace" : (amount[0].unit + amount[0].name);

        // to get utxos of payAddress
        let utxos = await this.getUtxo(payAddress, (this.paymentAddress !== payAddress));
        this.logger.debug("..plutusMsgTxBuilder......getUtxo utxos: ", payAddress, utxos.length, assetUnit);
        if (0 === utxos.length) {
            return undefined;
        }

        // to filter utxos in security block scopes
        let pendingSelectionUtxos = new Array();
        for (let i = 0; i < utxos.length; i++) {
            if ((this.paymentAddress === payAddress) ||
                ((undefined !== utxos[i].blockHeight)
                    && (utxos[i].blockHeight <= (this.curLatestBlock.height - config.SecurityBlocksForCoinSelection)))) {
                pendingSelectionUtxos.push(utxos[i]);
            }
        }

        // add asset type as filter params
        let availableUtxos = this.checkAvailableUtxos(payAddress, pendingSelectionUtxos, false, assetUnit);
        if (undefined === availableUtxos) {
            return undefined;
        }
        // this.logger.debug("..plutusMsgTxBuilder......checkAvailableUtxos: ", availableUtxos, amount);

        // to coin select utxos
        let filtedUtxo = this.selectUtxos(availableUtxos, toAddress, amount, limit);
        this.logger.debug("..plutusMsgTxBuilder......selectUtxos filtedUtxo: ", filtedUtxo);

        // to update selected utxos status to pendingConsumed
        let selectedUtxos = new Array();
        for (let j = 0; j < filtedUtxo.length; j++) {

            let utxoObj = filtedUtxo[j];
            let txId = utxoObj.txIn.txId;
            let txIndex = utxoObj.txIn.index;

            for (let k = 0; k < utxos.length; k++) {
                let utxo = utxos[k];
                if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                    selectedUtxos.push(utxo);

                    // to add new pending consumed utxos
                    let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(payAddress);
                    let encUtxo = this.commonUtil.encodeUtxo(utxoObj);
                    let utxoId = encUtxo.input().to_hex();
                    mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                    this.mapPendingConsumedUTXO.set(payAddress, mapConsumedUtxos);
                    break;
                }
            }
        }

        this.logger.debug("..plutusMsgTxBuilder......selectUtxos ret: ", selectedUtxos.length);
        let ret = {
            "selectedUtxos": selectedUtxos,
            "totalUtxos": utxos
        }
        return ret;
    }

    fetchRefUtxoFromMem(checkVH) {
        const ref = this.memScriptRefUtxos.find(o => {
            let v2Tag = true;
            let scriptBuff = o.script['plutus:v2'];
            if (undefined === scriptBuff) {
                v2Tag = false;
                scriptBuff = o.script['plutus:v3'];
            }
            const buf = Buffer.from(scriptBuff, 'hex');
            const cborHex = cbor.encode(buf, 'buffer');

            let scriptHash = v2Tag ? CardanoWasm.PlutusScript.from_bytes_v2(cborHex).hash().to_hex() : CardanoWasm.PlutusScript.from_bytes_v3(cborHex).hash().to_hex();
            return scriptHash == checkVH
        });

        return ref;
    }

    async getScriptRefUtxoByVH(checkVH) {
        // this.logger.debug(`..PlutusMsgTxBuilder....getScriptRefUtxoByVH ${refUtxo.length} utxos of scriptRefOwner: ${this.scriptRefOwnerAddr} `);

        let ref = this.fetchRefUtxoFromMem(checkVH);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.fetchRefUtxoFromMem(checkVH);
        }
        // this.logger.debug(`..PlutusMsgTxBuilder.... getScriptRefUtxoByVH's ref-utxo: ${JSON.stringify(ref)} `);
        return ref;
    }

    async getScriptRefUtxo(script) {
        // this.logger.debug(`..PlutusMsgTxBuilder....get ${refUtxo.length} utxos of scriptRefOwner: ${this.scriptRefOwnerAddr} `);

        let ref = this.memScriptRefUtxos.find(o => script.to_hex().indexOf(o.script['plutus:v2'] || o.script['plutus:v3']) >= 0);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.memScriptRefUtxos.find(o => script.to_hex().indexOf(o.script['plutus:v2'] || o.script['plutus:v3']) >= 0);
        }
        // this.logger.debug(`..PlutusMsgTxBuilder.... scriptRefOwner's ref-utxo: ${JSON.stringify(ref)} `);
        return ref;
    }

    signFn(hash) {
        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(this.paymentSkey, 'hex'));
        const signature = payPrvKey.sign(Buffer.from(hash, 'hex')).to_hex();
        const vkey = payPrvKey.to_public().to_bech32();
        // this.logger.debug("..plutusMsgTxBuilder......signFn: ", vkey, signature);
        return { vkey, signature };
    }

    async evaluateFn(rawTx) {
        // add exception catch for connector
        try {
            return await this.connector.evaluateTx(CardanoWasm.Transaction.from_hex(rawTx).to_bytes());
        } catch (e) {
            this.logger.debug("..plutusMsgTxBuilder......evaluateTx error: ", e);
            throw e;
        }
    }

    revertUtxoPendingComsumedStatus(inputUtxos) {

        for (let i = 0; i < inputUtxos.length; i++) {
            // to generate tx input based on txId&index
            let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(inputUtxos[i].txId, 'hex'));
            let txInput = CardanoWasm.TransactionInput.new(transaction_id, inputUtxos[i].index);

            // to generate utxoId by txInput
            let utxoId = txInput.to_hex();
            // this.logger.debug(`..plutusMsgTxBuilder..release utxo: ${inputUtxos[i].txId + '#' + inputUtxos[i].index} related to Key: ${utxoId}`);

            for (let address of this.mapPendingConsumedUTXO.keys()) {
                let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
                this.logger.debug("..plutusMsgTxBuilder...release origin mapConsumedUtxos: ", address, mapConsumedUtxos);
                if (mapConsumedUtxos.get(utxoId)) {
                    // this.logger.debug(`..plutusMsgTxBuilder..release utxoId: #${utxoId} in pendingUtxo of address: ${address}`);

                    mapConsumedUtxos.delete(utxoId);
                    this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
                    this.logger.debug("..plutusMsgTxBuilder...release updated mapConsumedUtxos: ", mapConsumedUtxos);
                    break;
                };
            }
        }
    }

    releaseUtxos(utxos) {
        let aryUtxos = undefined;
        if (utxos instanceof Array) {
            aryUtxos = utxos;
        } else {
            aryUtxos = [utxos];
        }

        let revertedUtxos = new Array();
        for (let i = 0; i < aryUtxos.length; i++) {
            let utxoItem = {
                "txId": aryUtxos[i].txHash,
                "index": aryUtxos[i].index
            }
            revertedUtxos.push(utxoItem);
            // this.logger.debug(`..plutusMsgTxBuilder...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
        }

        this.revertUtxoPendingComsumedStatus(revertedUtxos);
    }

    async buildAndSignMsgRawTx(basicArgs, partialRedeemerArgs, internalSignFunc) {
        const to = basicArgs.crossAddress;
        const tokenId = basicArgs.tokenId;
        const metaData = basicArgs.metaData;
        const uniqueId = basicArgs.hashX;
        const userData = partialRedeemerArgs.userData; 
        const addtionalAdaAmount = basicArgs.addtionalAdaAmount; 
        const crossMsgData = basicArgs.crossMsgData; // from agent; 
        this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...buildAndSignMsgRawTx basicArgs: ", basicArgs);

        // Step 1: to get treasury data     
        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        // this.logger.debug("..plutusMsgTxBuilder...buildAndSignMsgRawTx...groupInfoFromDatum...groupInfo: ", groupInfo);
        let inboundCheckVH = groupInfo[contractsMgr.GroupNFT.InboundCheckVH];
        // Step 1-1: treasuryCheckRef&&Uxto 
        let inboundCheckRefData = await this.getInboundCheckRefAndAvailableUtxo(inboundCheckVH);
        if (undefined == inboundCheckRefData) {
            throw "empty cctp mint check ref or utxo  for uniqueId: " + uniqueId;
        }
        let inboundCheckUxto = inboundCheckRefData.checkUtxo;
        let inboundCheckRef = inboundCheckRefData.checkRef;
        // this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...inbound check ref utxo: ", inboundCheckUxto, inboundCheckRef);

        // Step 1-2: treasury Ref utxo
        let inboundTokenRef = await this.getScriptRefUtxo(msgContracts.InboundTokenScript.script());
        if (undefined === inboundTokenRef) {
            this.releaseUtxos(inboundCheckUxto);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound check Utxo: ", inboundCheckUxto);
            throw "empty inbound token script ref  for uniqueId: " + uniqueId;
        }
        
        // Step 2: to get leader utxos for mint fee
        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT);
        if (undefined !== addtionalAdaAmount) {
            feeAmount = feeAmount.checked_add(CardanoWasm.BigNum.from_str(addtionalAdaAmount));
        }
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.getUtxoOfAmount(this.paymentAddress, to, feeValue, undefined);
        if (undefined === paymentUtxosRet) {
            this.releaseUtxos(inboundCheckUxto);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound check Utxo: ", inboundCheckUxto);
            throw "get leader utxos failed for inbound tx fee  for uniqueId: " + uniqueId;
        }

        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.releaseUtxos(inboundCheckUxto);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound check Utxo: ", inboundCheckUxto);
            throw "insufficent leader utxos for inbound tx fee for uniqueId: " + uniqueId;
        }

        let collateralUtxos = undefined; // len is no more than 3, sort by ada & fetch the 3 largest item
        if (config.PlutusCfg.maxCollacteralUtxosNum < utxosForFee.length) {
            utxosForFee.sort(this.compareUtxoAssetValue("lovelace").bind(this));
            collateralUtxos = new Array();
            for (let i = 0; i < config.PlutusCfg.maxCollacteralUtxosNum; i++) {
                let utxoIndex = utxosForFee.length - i - 1;
                collateralUtxos.push(utxosForFee[utxoIndex]);
            }
        } else {
            collateralUtxos = utxosForFee;
        }
        //this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...utxos For Fee & Collateral: ", utxosForFee, collateralUtxos);

        //TODO：utxosForFee 应该是个数组?--fixed
        let validTTL = this.curChainTip.slot + config.MaxTxTTL;
        const nonce = { txHash: inboundCheckUxto.txHash, index: inboundCheckUxto.index };

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...buildAndSignMsgRawTx convertSlotToTimestamp exception: ", err);

            this.releaseUtxos(inboundCheckUxto);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound check Utxo: ", inboundCheckUxto);
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound utxosForFee: ", utxosForFee);
            throw err;
        }

        const redeemerProof = {
            proofData: {
                crossMsgData: crossMsgData, nonce: nonce, mode: this.signMode, ttl: ttl2Ts
            },
            txTTL: validTTL,
            pk: this.groupPK,
            txType: config.TaskType.crossTask,
            uniqueId: uniqueId,
            signature: ''
        };
        this.logger.debug(".....plutusMsgTxBuilder...", uniqueId, "...inbound redeemerProof: ", JSON.stringify(redeemerProof));

        try {
            const redeemProofHash = msgContracts.InboundCheckScript.caculateRedeemDataHash(redeemerProof.proofData);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...inbound caculateRedeemDataHash: ", redeemProofHash);            

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
        } catch (e) {
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...buildAndSignMsgRawTx internalSignFunc exception: ", e);
            this.releaseUtxos(inboundCheckUxto);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound check Utxo: ", inboundCheckUxto);
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...release inbound utxosForFee: ", utxosForFee);
            throw e;
        }

        // Step 4: to build mint value
        try {
            //protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, 
            // redeemProof, changeAddress, evaluateFn, signFn, ttl
            const signedTxOutBound = await msgContracts.InboundTokenScript.mint(this.protocolParams, utxosForFee, collateralUtxos,
                inboundTokenRef, inboundCheckRef, this.groupInfoToken, inboundCheckUxto, redeemerProof, this.paymentAddress,
                this.evaluateFn.bind(this), this.signFn.bind(this), validTTL);

            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...buildAndSignMsgRawTx...signedTxOutBound finished. ");
            return signedTxOutBound;
        } catch (e) {
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...buildAndSignMsgRawTx error: ", e);
            this.releaseUtxos(inboundCheckUxto);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...inbound check Utxo: ", inboundCheckUxto);
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..plutusMsgTxBuilder...", uniqueId, "...inbound utxosForFee: ", utxosForFee);
            throw e;
        }
    }


    //////////////////////////////////
    //// Decode tx redeemer data
    //////////////////////////////////
    async deCodeTxRedeemersCbor(txInfo) {
        // this.logger.debug("..plutusMsgTxBuilder...", txInfo.hash, "...deCodeTxRedeemersCbor txInfo: ", txInfo);

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txInfo.hash);
            // this.logger.debug("..plutusMsgTxBuilder...deCodeTxRedeemersCbor...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..plutusMsgTxBuilder...deCodeTxRedeemersCbor...get txsUtxos...error: ", e);
            throw e;
        }
        
        const inbound_policyId = msgContracts.InboundTokenScript.policy_id();
        const outbound_policyId = msgContracts.OutboundTokenScript.policy_id();
        for (let i = 0; i < txUtxos.outputs.length; i++) {

            const tmpTxUtxo = txUtxos.outputs[i];
            // console.log("\n\n...deCodeTxRedeemersCbor...subInputObj: ", i, tmpTxUtxo);
            if (undefined === tmpTxUtxo.amount) {
                continue;
            }
            // Todo: to check token policyId
            for (let j = 0; j < tmpTxUtxo.amount.length; j++) {
                let assetItem = tmpTxUtxo.amount[j];
                let assetUnitInfo = assetItem.unit.split(".");

                if (inbound_policyId === assetUnitInfo[0]) {
                    let utxoDatum = this.connector.bUseOgmios ? tmpTxUtxo.data_hash : tmpTxUtxo.inline_datum;
                    let decodedMsgData = this.crossMsgDataFromCbor(utxoDatum);
                    let ret = {
                        "msgData": decodedMsgData,
                        "bInbound": true,
                        "policyId": inbound_policyId
                    }
                    return ret;
                    
                }else if (outbound_policyId === assetUnitInfo[0]) {
                    let utxoDatum = this.connector.bUseOgmios ? tmpTxUtxo.data_hash : tmpTxUtxo.inline_datum;
                    let decodedMsgData = this.crossMsgDataFromCbor(utxoDatum);                    
                    let ret = {
                        "msgData": decodedMsgData,
                        "bInbound": false,
                        "policyId": outbound_policyId
                    }
                    return ret; 
                }
            }
        }

        return undefined;
    }

    async genRedeemProofHash(redeemProof) {
        try {
            // this.logger.debug("..plutusMsgTxBuilder......genRedeemProofHash redeemerProof: ", JSON.stringify(redeemProof, null, 0))
            let redeemProofHash = msgContracts.InboundCheckScript.caculateRedeemDataHash(redeemProof.proofData);
            this.logger.debug("..plutusMsgTxBuilder......genRedeemProofHash caculateRedeemDataHash: ", redeemProofHash);

            return redeemProofHash;
        } catch (e) {
            this.logger.error("..plutusMsgTxBuilder...genRedeemProofHash...catch error : ", e);
            throw e;
        }
    }

    compareUtxoAssetValue(assetUnit) {

        return function (utxoItemA, utxoItemB) {

            if ((undefined === utxoItemA) || (undefined === utxoItemB)
                || (undefined === utxoItemA.txOut) || (undefined === utxoItemB.txOut)
                || (undefined === utxoItemA.txOut.value) || (undefined === utxoItemB.txOut.value)) {
                return undefined;
            }

            let itemAssetValueA = CardanoWasm.BigNum.from_str("0");
            for (let v = 0; v < utxoItemA.txOut.value.length; v++) {
                let valueItem = utxoItemA.txOut.value[v];
                if (assetUnit === valueItem.unit) {
                    let tmpAmount = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(valueItem.quantity));
                    itemAssetValueA = itemAssetValueA.checked_add(tmpAmount);
                }
            }

            let itemAssetValueB = CardanoWasm.BigNum.from_str("0");;
            for (let v = 0; v < utxoItemB.txOut.value.length; v++) {
                let valueItem = utxoItemB.txOut.value[v];
                if (assetUnit === valueItem.unit) {
                    let tmpAmount = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(valueItem.quantity));
                    itemAssetValueB = itemAssetValueB.checked_add(tmpAmount);
                }
            }

            let ret = itemAssetValueA.compare(itemAssetValueB);
            return ret;
        }
    }

    async getInboundCheckAddress() {
        let tmpGroupInfoToken = await this.getGroupInfoToken();
        if (false === tmpGroupInfoToken) {
            throw "exception network during get group info token";
        } else {
            this.groupInfoToken = tmpGroupInfoToken;
        }

        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        // this.logger.debug("..plutusMsgTxBuilder......groupInfoFromDatum...groupInfo: ", groupInfo);

        let checkStkVh = groupInfo[contractsMgr.GroupNFT.StkVh];
        // this.logger.debug("..plutusMsgTxBuilder......groupInfoFromDatum...stkVh: ", checkStkVh);
        let vhItemName = contractsMgr.GroupNFT.InboundCheckVH;
        let checkPayVh = groupInfo[vhItemName];
        // this.logger.debug("..plutusMsgTxBuilder......groupInfoFromDatum...checkPayVh: ", vhItemName, checkPayVh);

        let checkStkKeyHash = CardanoWasm.ScriptHash.from_hex(checkStkVh); //Ed25519KeyHash
        let checkPayKeyHash = CardanoWasm.ScriptHash.from_hex(checkPayVh);

        let checkAddress = CardanoWasm.BaseAddress.new(
            this.network_id,
            CardanoWasm.Credential.from_scripthash(checkPayKeyHash),
            CardanoWasm.Credential.from_scripthash(checkStkKeyHash) //from_keyhash
        );

        let strCheckAddress = checkAddress.to_address().to_bech32(this.ADDR_PREFIX);
        return strCheckAddress;
    }

    async getInboundCheckRefAndAvailableUtxo(checkVH) {
        // Step 1: treasuryCheckRefUtxo
        let treasuryCheckRef = await this.getScriptRefUtxoByVH(checkVH);
        if (undefined === treasuryCheckRef) {
            this.logger.debug("..plutusMsgTxBuilder...getScriptRefUtxoByVH...error:: no available check ref utxo");
            return undefined;
        }

        // Step 2: treasuryCheckUxto  : to monitor this script check utxos
        let scriptCheckRefAddress = await this.getInboundCheckAddress();
        let inboundCheckUxto = await this.getScriptCheckRefAvailableUtxo(scriptCheckRefAddress);
        if (undefined === inboundCheckUxto) {
            this.logger.debug("..plutusMsgTxBuilder...getScriptCheckRefAvailableUtxo...warning:: no available check utxo");
            return undefined;
        }

        let ret = {
            "checkUtxo": inboundCheckUxto,
            "checkRef": treasuryCheckRef
        }
        return ret;
    }

    async getInboundCheckUtxosTotalNum() {
        let scriptCheckRefAddress = await this.getInboundCheckAddress();
        let availableCheckUtxoCount = 0;

        let utxos = await this.getUtxo(scriptCheckRefAddress, false);
        for (let i = 0; i < utxos.length; i++) {
            let utxoItem = {
                "txId": utxos[i].txHash,
                "index": utxos[i].index
            }
            // this.logger.debug(`..plutusMsgTxBuilder...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
            let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoItem.txId, 'hex'));
            let txInput = CardanoWasm.TransactionInput.new(transaction_id, utxoItem.index);

            // to generate utxoId by txInput
            let utxoId = txInput.to_hex();
            // this.logger.debug(`..plutusMsgTxBuilder..getInboundCheckUtxosTotalNum...to match Key: ${utxoId}`);

            let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(scriptCheckRefAddress);
            if (mapConsumedUtxos.get(utxoId)) {
                // this.logger.debug(`..plutusMsgTxBuilder..release utxoId: #${utxoId} in pendingUtxo of address: ${address}`);
                continue;
            };

            availableCheckUtxoCount++;
        }

        this.logger.debug("..plutusMsgTxBuilder...availalbe check utxos num: ", scriptCheckRefAddress, availableCheckUtxoCount);
        return availableCheckUtxoCount;
    }

    crossMsgDataFromCbor(inboundDataCbor){
        let crossMsgData = plutusdata.crossMsgDataFromCbor(inboundDataCbor, this.network_id);
        return crossMsgData;
    }

    getInboundTokenPolicyId(){
        let policyId = msgContracts.InboundTokenScript.policy_id();
        return policyId;
    }

    getOutboundTokenPolicyId(){
        let policyId = msgContracts.OutboundTokenScript.policy_id();
        return policyId;
    }

}


module.exports = plutusMsgTxBuilder;






