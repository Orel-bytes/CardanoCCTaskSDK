const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const BigNumber = require('bignumber.js');
const contracts = require('./cross-chain-js/contracts');
const contractsMgr = require('./cross-chain-js/contracts-mgr');
const utils = require('./cross-chain-js/utils');
const common = require('./util/common');
const config = require('./config');
const cbor = require('cbor-sync');

const LEADER_FEE_AMOUNT = "5000000";

class PlutusTxBuilder {

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

        contracts.init(bMainnet);
        if (0 === config.SignAlgorithmMode) {
            this.signMode = contracts.TreasuryScript.MODE_ECDSA;
        } else if (2 === config.SignAlgorithmMode) {
            this.signMode = contracts.TreasuryScript.MODE_ED25519;
        } else {
            this.signMode = contracts.TreasuryScript.MODE_SCHNORR340;
        }

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
        this.mapScBalancedMarkRecord = new Map();
        this.mapForcedBalancedStatus = new Map();

        this.mapAddressAvailableUtxos = new Map();
        this.mapAccountLocker = new Map();

        // supportted token 
        this.mapValidAssetType = new Map();
        this.mapBalancedDirection = new Map();
        this.mapAssetBalancedTs = new Map();
        this.mapAssetAdaSptrippedTs = new Map();

        // to new common util instance
        this.commonUtil = new common(this.ADDR_PREFIX);
        this.logger = logUtil;

        this.memScriptRefUtxos = new Array();
    }

    init() {
        // let stakeCred = await this.getGroupInfoStkVh();
        // this.lockerScAddress = contracts.TreasuryScript.address(stakeCred).to_bech32(this.ADDR_PREFIX);
        this.lockerScAddress = this.bMainnet ? config.MainNet.TreasuryScAddress : config.TestNet.TreasuryScAddress;
        console.log("\n\n\n\******* this.lockerScAddress: ", this.lockerScAddress);
        if (undefined === this.lockerScAddress) {
            return false;
        }

        this.validCheckTokenPolicyId = contracts.TreasuryCheckTokenScript.policy_id();
        this.validMappingCheckTokenPolicyId = contracts.MintCheckTokenScript.policy_id();

        this.instanceFlag = parseInt(new Date().getTime());
        this.logger.debug("..PlutusTxBuilder...", "...txBuilder instance has been initialied...", this.instanceFlag);
        return true;
    }

    getCheckTokenPolicyId() {
        return this.validCheckTokenPolicyId;
    }

    getMintCheckTokenPolicyId() {
        return this.validMappingCheckTokenPolicyId;
    }

    getLockerScAddress() {
        return this.lockerScAddress;
    }

    getValidPolicyId() {
        let validPolicyId = contracts.MappingTokenScript.policy_id();
        return validPolicyId
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
        this.groupInfoToken = await this.getGroupInfoToken();
        // this.logger.debug("..PlutusTxBuilder......updateGroupInfoToken..groupInfoToken: ", groupInfoToken);
        if (false === this.groupInfoToken) {
            this.logger.debug("..PlutusTxBuilder......failed to get groupInfoToken: ");
            return false;
        }

        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
        return true;
    }

    async getCurChainParams() {
        let latestChainTip = undefined;
        try {
            latestChainTip = await this.connector.chainTip();
            // this.logger.debug("..PlutusTxBuilder......latestChainTip: ", latestChainTip);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder......failed to get chainTip: ", e);
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
                // this.logger.debug("..PlutusTxBuilder......this.curLatestBlock: ", this.curLatestBlock);
            } catch (e) {
                this.logger.debug("..PlutusTxBuilder......get blocksLatest failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                let tmpProtocolParams = await this.connector.getCurrentProtocolParameters();
                // this.logger.debug("..PlutusTxBuilder......protocolParams: ", this.protocolParams);
                if ((undefined === tmpProtocolParams) || ("" === tmpProtocolParams)) {
                    this.logger.debug("..PlutusTxBuilder......getCurChainParams failed: ");
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
                this.logger.debug("..PlutusTxBuilder......getCurChainParams failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                this.curChainTip = await this.connector.chainTip();
                this.logger.debug("..PlutusTxBuilder......get this.curChainTip onchain: ", this.curChainTip);

            } catch (e) {
                this.logger.debug("..PlutusTxBuilder......get chainTip failed: ", e);
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
        // this.logger.debug("..PlutusTxBuilder......getUtxo address: ", address, bCheckDatum);

        //if (undefined === this.curChainTip) {
        try {
            let rslt = await this.getCurChainParams();
            if (false === rslt) {
                this.logger.debug("..PlutusTxBuilder...getUtxo...getCurChainParams: ", rslt);
                return ret;
            }

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...getUtxo...getCurChainParams failed: ", e);
            return ret;
        }
        //}

        // to check if need to query from ogmios service
        let utxoRecordObj = this.mapAddressAvailableUtxos.get(address);
        if ((undefined !== utxoRecordObj)
            && (utxoRecordObj.recordSlot > (this.curChainTip.slot - config.UtxoValidLatestSlot))) {
            // pre-backup utxo is still valid
            //this.logger.debug("..PlutusTxBuilder......getUtxo...utxoRecordObj.utxos: ", utxoRecordObj.utxoRecords);
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
                    // this.logger.debug(`..PlutusTxBuilder...getAddressUTXOsWithBlockHeight ${address}...${rslt.utxos}`);        
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
                this.logger.debug("..PlutusTxBuilder......getUtxo...getAddressUTXOs failed: ", e);
                this.mapAccountLocker.set(address, false);
                return ret;
            }
        }
        // this.logger.debug(`..PlutusTxBuilder...getUtxo return ${utxos.length} utxo of ${address}`);

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

            // filter utxo with null datum
            let utxoDatum = this.connector.bUseOgmios ? utxo.data_hash : utxo.inline_datum;
            // this.logger.debug("..PlutusTxBuilder......utxo utxoDatum: ", bCheckDatum, utxo.data_hash)
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

        // this.logger.debug("..PlutusTxBuilder......ret len: ", ret.length);
        return ret;
    }

    async getGroupInfoToken() {
        const groupInfoHolder = contractsMgr.GroupInfoNFTHolderScript.address().to_bech32(this.ADDR_PREFIX);
        this.logger.debug("..PlutusTxBuilder......GroupInfoNFTHolderScript address: ", groupInfoHolder);

        let expectedTokenId = contractsMgr.GroupNFT.tokenId(); // need liulin confirm
        expectedTokenId = expectedTokenId.replace(".", "")
        const groupInfoToken = (await this.getUtxo(groupInfoHolder)).find(o => {
            for (let tokenId in o.value.assets) {
                tokenId = tokenId.replace(".", "");
                if (tokenId == expectedTokenId) return true;
            }
            return false;
        });
        //this.logger.debug("..PlutusTxBuilder......groupInfoToken ", groupInfoToken);
        if (undefined === groupInfoToken) {
            return false;
        }
        return groupInfoToken;
    }

    async getGroupInfoStkVh() {
        this.groupInfoToken = await this.getGroupInfoToken();
        //this.logger.debug("..PlutusTxBuilder......getGroupInfoToken...: ", this.groupInfoToken);
        if (false === this.groupInfoToken) {
            throw "exception network during get group info token";
        }

        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        //this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...groupInfo: ", groupInfo);

        let StkVh = groupInfo[contractsMgr.GroupNFT.StkVh];
        //this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...StkVh: ", StkVh);

        return StkVh;
    }

    async getTreasuryCheckAddress(bMintCheck) {
        this.groupInfoToken = await this.getGroupInfoToken();
        // this.logger.debug("..PlutusTxBuilder......getGroupInfoToken...: ", this.groupInfoToken);
        if (false === this.groupInfoToken) {
            throw "exception network during get group info token";
        }

        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        // this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...groupInfo: ", groupInfo);

        let checkStkVh = groupInfo[contractsMgr.GroupNFT.StkVh];
        // this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...stkVh: ", checkStkVh);

        let vhItemName = bMintCheck ? contractsMgr.GroupNFT.MintCheckVH : contractsMgr.GroupNFT.TreasuryCheckVH;
        let checkPayVh = groupInfo[vhItemName];
        // this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...checkPayVh: ", bMintCheck, vhItemName, checkPayVh);

        let checkStkKeyHash = CardanoWasm.ScriptHash.from_hex(checkStkVh); //Ed25519KeyHash
        let checkPayKeyHash = CardanoWasm.ScriptHash.from_hex(checkPayVh);

        let checkAddress = CardanoWasm.BaseAddress.new(
            this.network_id,
            CardanoWasm.Credential.from_scripthash(checkPayKeyHash),
            CardanoWasm.Credential.from_scripthash(checkStkKeyHash) //from_keyhash
        );

        let strCheckAddress = checkAddress.to_address().to_bech32(this.ADDR_PREFIX);
        // this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...strCheckAddress: ", strCheckAddress);
        if (bMintCheck) {
            let mintCheckTokenPolicyId = contracts.MintCheckTokenScript.policy_id();
            // this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...mintCheckTokenPolicyId: ", mintCheckTokenPolicyId);
        } else {
            let checkTokenPolicyId = contracts.TreasuryCheckTokenScript.policy_id();
            // this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...checkTokenPolicyId: ", checkTokenPolicyId);
        }
        return strCheckAddress;
    }

    ///modify_2.21: add new valid asset tyep interface
    addSupportedAssetType(tokenId) {
        this.mapValidAssetType.set(tokenId, true);
    }

    async buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs) {
        //this.logger.debug("..PlutusTxBuilder...buildSignedTx......basicArgs:", basicArgs);
        //this.logger.debug("..PlutusTxBuilder...buildSignedTx......partialRedeemerArgs:", partialRedeemerArgs);
        this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...begin to build Signed Tx! ");
        this.paymentAddress = basicArgs.paymentAddress;
        this.paymentSkey = basicArgs.paymentSKey;

        if (undefined === this.lockerScAddress) {
            let ret = await this.init();
            if (false === ret) {
                throw "failed to initial sdk!";
            }
        }

        //Step 1: to get groupInfoToken and fetch group pk
        let encodedGpk = this.commonUtil.encodeGpk(basicArgs.gpk);
        // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...this.groupInfoToken: ", this.groupInfoToken);
        if (this.groupPK !== encodedGpk) {
            this.groupInfoToken = await this.getGroupInfoToken();
            //this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getGroupInfoToken...: ", this.groupInfoToken);
            if (false === this.groupInfoToken) {
                throw "exception network during get group info token";
            }

            const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
            //this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...groupInfoFromDatum...groupInfo: ", groupInfo);
            this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
            this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...groupInfoFromDatum...groupPK: ", this.groupPK);

            if (this.groupPK !== encodedGpk) {
                throw "inconsistent gpk";
            }
        }
        console.log("\n\n... this.groupPK: ", this.groupPK);

        // to register valid asset type
        if (undefined === this.mapValidAssetType.get(basicArgs.tokenId)) {
            this.addSupportedAssetType(basicArgs.tokenId);
        }

        // Step 2: to get cardano current netParams
        let bRet = await this.getCurChainParams();
        // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getCurChainParams......bRet:", bRet);
        if (false === bRet) {
            throw "exception network during update protocal params";
        }

        bRet = await this.fetchBalancedParams();
        // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...fetchBalancedParams......bRet:", bRet);
        if (false === bRet) {
            throw "exception network during update balanced params";
        }

        // Step 3: to build cardano cross-chain tx
        let signedTx = await this.genSignedTxData(basicArgs, partialRedeemerArgs, internalSignFunc);
        // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...genSignedTxData......ret:", signedTx);
        return signedTx;
    }

    async genSignedTxData(basicArgs, partialRedeemerArgs, internalSignFunc) {

        const owner = basicArgs.crossAddress;
        const ccTaskAmount = basicArgs.amount;
        const tokenId = basicArgs.tokenId;
        ///this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...basicArgs: ", basicArgs);

        // to confirm transfer asset value
        let adaAmount = "0";
        let tokenAmount = "0";
        const datum = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        if (config.AdaTokenId === tokenId) {
            adaAmount = ccTaskAmount;
            const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, owner, { coins: adaAmount, assets: {} }, datum);
            // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getMinAdaOfUtxo: ", minAda, typeof (minAda));

            const bnAdaAmount = new BigNumber(adaAmount);
            const bnMinAda = new BigNumber(minAda);
            if (bnAdaAmount.lt(bnMinAda)) {
                this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...adaAmount: ", adaAmount, typeof (adaAmount));
                throw 'lt than minAda';
            }
        } else {
            tokenAmount = ccTaskAmount;
            const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, owner, { coins: 0, assets: { [tokenId]: tokenAmount } }, datum);
            // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getMinAdaOfUtxo: ", minAda, typeof (minAda));

            adaAmount = minAda.toString();
        }
        // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...enough token amount: ", adaAmount, tokenId, tokenAmount);

        // to build & sign normal cc tx or token mint tx by basciArgs params
        let buildRet = undefined;
        if (!basicArgs.bMint) {
            buildRet = await this.buildAndSignRawTx(internalSignFunc, basicArgs, tokenAmount, adaAmount, partialRedeemerArgs);
        } else {
            buildRet = await this.buildAndSignMintRawTx(internalSignFunc, basicArgs, tokenAmount, partialRedeemerArgs);
        }

        this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...buildAndSignRawTx...signedTxData: ", buildRet);
        return buildRet;
    }

    // add filter param of asset units
    filterAvailableUtxos(availableUtxos, value) {
        // this.logger.debug("..PlutusTxBuilder......filterAvailableUtxos value: ", value);
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
        //this.logger.debug("..PlutusTxBuilder......filterAvailableUtxos... utxo pool: ", availableUtxos);
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

        // this.logger.debug("..PlutusTxBuilder......filterAvailableUtxos... filtered utxo: ", selectionParam_inputs);
        return selectionParam_inputs;
    }

    selectUtxos(utxos, toAddress, value, limit) {
        if (undefined === limit) {
            limit = config.PlutusCfg.leaderUtxoNumLimit;
        }

        this.coinSelectionInst.setProtocolParameters(this.coinsPerUtxoByte, this.minFeeA, this.minFeeB, '10000');
        // this.logger.debug("..PlutusTxBuilder......selectUtxos toAddress: ", toAddress);

        // step 1: to build output params
        // this.logger.debug("..PlutusTxBuilder......buildOutputValue value: ", value);
        let outputAddress = CardanoWasm.Address.from_bech32(toAddress);
        // this.logger.debug("..PlutusTxBuilder......outputAddress: ", outputAddress);
        let outputValue = this.commonUtil.buildOutputValue(value, undefined, this.coinsPerUtxoWord);
        // this.logger.debug("..PlutusTxBuilder......buildOutputValue ret: ", outputValue);
        let txOutput = CardanoWasm.TransactionOutput.new(outputAddress, outputValue);
        // this.logger.debug("..PlutusTxBuilder......TransactionOutput ret: ", txOutput);

        let selectionParam_outputs = CardanoWasm.TransactionOutputs.new();
        selectionParam_outputs.add(txOutput);

        // step 2: to filter available utxo and build input params
        let selectedUtxos = new Array();
        let selectionParam_inputs = this.filterAvailableUtxos(utxos, value);
        this.logger.debug("..PlutusTxBuilder......filterAvailableUtxos inputs len: ", selectionParam_inputs.length);
        if (0 === selectionParam_inputs.length) {
            return selectedUtxos;

        } else if (1 === selectionParam_inputs.length) {
            // only left 1 suitable for task, just simple to compare amount between amount of task and quantity of utxo
            // no need to random select by coinselectionInst because it may be failed.
            try {
                let utxoInfoObj = this.commonUtil.decodeUtxo(selectionParam_inputs[0]);
                let utxoValues = utxoInfoObj.txOut.value;

                let strTargetUnit = ("lovelace" === value[0].unit) ? "lovelace" : (value[0].unit + "." + value[0].name);
                this.logger.debug("..PlutusTxBuilder......selectUtxos", "only one utxo...strTargetUnit", strTargetUnit);

                let bnUtxoAssetAmount = CardanoWasm.BigNum.from_str("0");
                for (let i = 0; i < utxoValues.length; i++) {
                    let objAssetItem = utxoValues[i];
                    let strAssetUnit = objAssetItem.unit;
                    this.logger.debug("..PlutusTxBuilder......selectUtxos", "only one utxo...strAssetUnit", strAssetUnit);

                    if (strTargetUnit === strAssetUnit) {
                        let strAssetAmount = objAssetItem.quantity;
                        let bnAssetAmount = CardanoWasm.BigNum.from_str(strAssetAmount);
                        bnUtxoAssetAmount = bnUtxoAssetAmount.checked_add(bnAssetAmount);
                    }
                }

                let strAmount = this.commonUtil.number2String(value[0].amount);
                let bnTaskAmount = CardanoWasm.BigNum.from_str(strAmount);
                this.logger.debug("..PlutusTxBuilder......selectUtxos", "task amount", strAmount);
                this.logger.debug("..PlutusTxBuilder......selectUtxos", "utxo's asset amount", bnUtxoAssetAmount.to_str());
                if (bnUtxoAssetAmount.compare(bnTaskAmount) >= 0) {
                    selectedUtxos.push(utxoInfoObj);
                    this.logger.debug("..PlutusTxBuilder......selectUtxos", "there is only one utxo left for task", selectedUtxos);
                }

                return selectedUtxos;

            } catch (e) {
                this.logger.debug("..PlutusTxBuilder......selectUtxos", "there is exception when parse one utxo for task", e);
                return selectedUtxos;
            }

        } else {

            let strTargetUnit = ("lovelace" === value[0].unit) ? "lovelace" : (value[0].unit + "." + value[0].name);
            let formateUtxos = new Array();

            try {
                this.logger.debug("..PlutusTxBuilder......try to select utxos limited by 1 !");
                let selectedRet = this.coinSelectionInst.randomImprove(selectionParam_inputs,
                    selectionParam_outputs,
                    1,
                    outputAddress); // the 3rd param should be changed into 20+tokenAssets

                for (let i = 0; i < selectedRet.input.length; i++) {
                    let utxo = selectedRet.input[i];
                    let utxoInfoObj = this.commonUtil.decodeUtxo(utxo);
                    formateUtxos.push(utxoInfoObj);
                }
                this.logger.debug("..PlutusTxBuilder......selectUtxos randomImprove by limit 1:", formateUtxos);

            } catch (e) {
                this.logger.debug("..PlutusTxBuilder......select by limit 1 failed! retry by default limit: ", limit);
                try {
                    let selectedRet = this.coinSelectionInst.randomImprove(selectionParam_inputs,
                        selectionParam_outputs,
                        limit,
                        outputAddress); // the 3rd param should be changed into 20+tokenAssets

                    for (let i = 0; i < selectedRet.input.length; i++) {
                        let utxo = selectedRet.input[i];
                        let utxoInfoObj = this.commonUtil.decodeUtxo(utxo);
                        formateUtxos.push(utxoInfoObj);
                    }
                    this.logger.debug("..PlutusTxBuilder......selectUtxos randomImprove by limit:", formateUtxos);

                } catch (error) {
                    this.logger.debug("..PlutusTxBuilder......selectUtxo warning : INPUTS EXHAUSTED!");
                    return selectedUtxos;
                }
            }

            // to sort utxos by amount
            formateUtxos.sort(this.compareUtxoAssetValue(strTargetUnit).bind(this));
            for (let j = 0; j < formateUtxos.length; j++) {
                let utxoInfoObj = formateUtxos[j];
                selectedUtxos.push(utxoInfoObj);

                let utxoValues = utxoInfoObj.txOut.value;
                let bnUtxoAssetAmount = CardanoWasm.BigNum.from_str("0");
                for (let i = 0; i < utxoValues.length; i++) {
                    let objAssetItem = utxoValues[i];
                    let strAssetUnit = objAssetItem.unit;

                    if (strTargetUnit === strAssetUnit) {
                        let strAssetAmount = objAssetItem.quantity;
                        let bnAssetAmount = CardanoWasm.BigNum.from_str(strAssetAmount);
                        bnUtxoAssetAmount = bnUtxoAssetAmount.checked_add(bnAssetAmount);
                    }
                }

                let strAmount = this.commonUtil.number2String(value[0].amount);
                let bnTaskAmount = CardanoWasm.BigNum.from_str(strAmount);
                if (bnUtxoAssetAmount.compare(bnTaskAmount) >= 0) {
                    //this.logger.debug("..PlutusTxBuilder......adjusted selectUtxos:", selectedUtxos.length, selectedUtxos);
                    break;
                }
            }

            //this.logger.debug("..PlutusTxBuilder......final selectUtxos:", selectedUtxos.length, selectedUtxos);
            return selectedUtxos;
        }
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
                // this.logger.debug("..PlutusTxBuilder......mapAssetUnit set :", itemValue.unit, assetUnit);
            }

            // to filter multi-asset utxos
            //this.logger.debug("..PlutusTxBuilder......mapAssetUnit size :", mapAssetUnit.size);
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
        //this.logger.debug("..PlutusTxBuilder...checkAvailableUtxos...availableUtxos length:", payAddress, assetUnit);

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
                // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos...available Utxo:", i, JSON.stringify(availableUtxos[i]));
                let encUtxo = this.commonUtil.encodeUtxo(availableUtxos[i]);
                let utxoId = encUtxo.input().to_hex();
                let consumedInitialSlot = mapConsumedUtxos.get(utxoId);
                // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos...", "txBuilder instance flag", this.instanceFlag);
                // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos...Utxo info:", utxoId, JSON.stringify(availableUtxos[i]));
                // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos...Utxo consume state:", utxoId, consumedInitialSlot);
                if (undefined !== consumedInitialSlot) {
                    // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos...consumedInitialSlot:", consumedInitialSlot, this.curChainTip.slot);
                    continue;
                }

                // confirm available utxos
                if (undefined === filteredAvailableUtxos) {
                    filteredAvailableUtxos = new Array();
                }
                filteredAvailableUtxos.push(availableUtxos[i]);
                // this.logger.debug("..PlutusTxBuilder......add into..filteredAvailableUtxos...:",  JSON.stringify(availableUtxos[i]));
            }
        }

        //this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos :", payAddress, JSON.stringify(filteredAvailableUtxos));
        //this.logger.debug("..PlutusTxBuilder...checkAvailableUtxos...assetUnit:", payAddress, assetUnit);
        if(undefined !== filteredAvailableUtxos){
            // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos :", availableUtxos.length, filteredAvailableUtxos.length);
            this.logger.debug(`..PlutusTxBuilder....filteredAvailableUtxos ${payAddress} asset:${assetUnit} totalUtxoLen:${availableUtxos.length} availableUtxoLen:${filteredAvailableUtxos.length}`);
        }else{
            // this.logger.debug("..PlutusTxBuilder......filteredAvailableUtxos :", availableUtxos.length, 0);
            this.logger.debug(`..PlutusTxBuilder....filteredAvailableUtxos ${payAddress} asset:${assetUnit} totalUtxoLen:${availableUtxos.length} availableUtxoLen: 0`);
        }
        return filteredAvailableUtxos;
    }

    resetUtxoExpiredTime(payAddress, utxoTxHash, utxoIndex) {
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(payAddress);
        if (undefined === mapConsumedUtxos) {
            mapConsumedUtxos = new Map();
        }
        let utxoId = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(utxoTxHash), utxoIndex).to_hex();
        mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
        this.mapPendingConsumedUTXO.set(payAddress, mapConsumedUtxos);
    }

    async getScriptCheckRefAvailableUtxo(scriptCheckRefAddress) {

        let utxos = await this.getUtxo(scriptCheckRefAddress, false);
        this.logger.debug("..PlutusTxBuilder......get scriptCheckRef utxos: ", scriptCheckRefAddress, utxos.length);
        if (0 === utxos.length) {
            this.logger.debug("..PlutusTxBuilder.....warning: get no scriptCheckRef utxos.");
            return undefined;
        }

        let availableUtxos = this.checkAvailableUtxos(scriptCheckRefAddress, utxos, true);
        // this.logger.debug("..PlutusTxBuilder......availableUtxos: ", availableUtxos);
        if ((undefined === availableUtxos) || (availableUtxos.length < 1)) {
            this.logger.debug("..PlutusTxBuilder...getScriptCheckRefAvailableUtxo...warning: no available check utxo");
            return undefined;
        }

        // to filte the valid check token utxos with the valid policyId
        let validCheckTokenUtxos = this.fiterValidCheckTokenUtxos(availableUtxos);
        if ((undefined === validCheckTokenUtxos) || (validCheckTokenUtxos.length < 1)) {
            this.logger.debug("..PlutusTxBuilder...getScriptCheckRefAvailableUtxo...warning: no valid check utxo");
            return undefined;
        }

        let treasuryCheckUxto = undefined; // availableTreasuryCheckUxto

        let txId = validCheckTokenUtxos[0].txIn.txId;
        let txIndex = validCheckTokenUtxos[0].txIn.index;
        for (let k = 0; k < utxos.length; k++) {
            let utxo = utxos[k];
            if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                treasuryCheckUxto = utxo;
                // this.logger.debug("..PlutusTxBuilder......selected validCheckTokenUtxos: ", utxo);

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

        //this.logger.debug("..PlutusTxBuilder...", "getScriptCheckRefAvailableUtxo...Ret", JSON.stringify(treasuryCheckUxto));
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
            this.logger.debug("..PlutusTxBuilder...parseCheckTokenValidity", "tokenPolicyId", tokenPolicyId);
            if ((this.validCheckTokenPolicyId === tokenPolicyId)
                || (this.validMappingCheckTokenPolicyId === tokenPolicyId)) {
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
        this.logger.debug("..PlutusTxBuilder......getUtxo utxos: ", payAddress, utxos.length, assetUnit);
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
        // this.logger.debug("..PlutusTxBuilder......checkAvailableUtxos: ", availableUtxos, amount);

        // to coin select utxos
        let filtedUtxo = this.selectUtxos(availableUtxos, toAddress, amount, limit);
        // this.logger.debug("..PlutusTxBuilder...", "...selectUtxos filtedUtxo: ",  JSON.stringify(filtedUtxo));

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
                    this.logger.debug("..PlutusTxBuilder", "...getUtxoOfAmount...selected utxo object", utxoId);
                    break;
                }
            }
        }

        this.logger.debug("..PlutusTxBuilder......selectUtxos ret: ", selectedUtxos.length);
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
        // this.logger.debug(`..PlutusTxBuilder....getScriptRefUtxoByVH ${refUtxo.length} utxos of scriptRefOwner: ${this.scriptRefOwnerAddr} `);

        let ref = this.fetchRefUtxoFromMem(checkVH);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.fetchRefUtxoFromMem(checkVH);
        }
        // this.logger.debug(`..PlutusTxBuilder.... getScriptRefUtxoByVH's ref-utxo: ${JSON.stringify(ref)} `);
        return ref;
    }

    async getScriptRefUtxo(script) {
        // this.logger.debug(`..PlutusTxBuilder....get ${refUtxo.length} utxos of scriptRefOwner: ${this.scriptRefOwnerAddr} `);

        let ref = this.memScriptRefUtxos.find(o => script.to_hex().indexOf(o.script['plutus:v2'] || o.script['plutus:v3']) >= 0);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.memScriptRefUtxos.find(o => script.to_hex().indexOf(o.script['plutus:v2'] || o.script['plutus:v3']) >= 0);
        }
        // this.logger.debug(`..PlutusTxBuilder.... scriptRefOwner's ref-utxo: ${JSON.stringify(ref)} `);
        return ref;
    }

    signFn(hash) {
        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(this.paymentSkey, 'hex'));
        const signature = payPrvKey.sign(Buffer.from(hash, 'hex')).to_hex();
        const vkey = payPrvKey.to_public().to_bech32();
        // this.logger.debug("..PlutusTxBuilder......signFn: ", vkey, signature);
        return { vkey, signature };
    }

    async evaluateFn(rawTx) {
        // add exception catch for connector
        try {
            // return await this.connector.evaluateTx(CardanoWasm.Transaction.from_hex(rawTx).to_bytes());
            let result = await this.connector.evaluateTx(CardanoWasm.Transaction.from_hex(rawTx).to_bytes());
            if (undefined !== result.error) {
                throw "evaluate failed!";
            } else {
                return result;
            }
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder......evaluateTx error: ", e);
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
            // this.logger.debug(`..PlutusTxBuilder..release utxo: ${inputUtxos[i].txId + '#' + inputUtxos[i].index} related to Key: ${utxoId}`);

            for (let address of this.mapPendingConsumedUTXO.keys()) {
                let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
                // this.logger.debug("..PlutusTxBuilder...release origin mapConsumedUtxos: ", address, mapConsumedUtxos);
                if (mapConsumedUtxos.get(utxoId)) {
                    // this.logger.debug(`..PlutusTxBuilder..release utxoId: #${utxoId} in pendingUtxo of address: ${address}`);

                    mapConsumedUtxos.delete(utxoId);
                    this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
                    // this.logger.debug("..PlutusTxBuilder...release updated mapConsumedUtxos: ", mapConsumedUtxos);
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
            // this.logger.debug(`..PlutusTxBuilder...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
        }

        this.revertUtxoPendingComsumedStatus(revertedUtxos);
    }

    parseTreasuryUtxoChangeData(balancedParseRet, transferAmount, tokenAmount, userData = undefined) {

        let datum = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        if (undefined !== userData) {
            datum = CardanoWasm.PlutusData.from_hex(userData);
        }

        let bnOutputNum = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(balancedParseRet.outputNum));
        let formatUtxos = this.commonUtil.formatUtxoData(balancedParseRet.coordinateUtxos);

        let totalInputAmount = this.caculateInputValue(formatUtxos);
        let bnInputCoinValue = totalInputAmount.coin;

        let adaAmount = CardanoWasm.BigNum.from_str('0');
        let marginAda = CardanoWasm.BigNum.from_str('0');

        if ("lovelace" === transferAmount.unit) {
            console.log("\n..parseTreasuryUtxoChangeData transfer ada: ", transferAmount);
            const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, this.paymentAddress, { coins: transferAmount.amount, assets: {} }, datum);
            let bnMinAda = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(minAda));
            //console.log("\n..parseTreasuryUtxoChangeData bnMinAda: ", bnMinAda.to_str(), bnTransferValue.to_str(), bnInputCoinValue.to_str());
            const bnTransferValue = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(transferAmount.amount));

            if (0 === bnInputCoinValue.compare(bnTransferValue)) {
                console.log("\n..parseTreasuryUtxoChangeData bnInputCoinValue is equle with bnTransferValue: ", bnTransferValue.to_str());
                bnOutputNum = CardanoWasm.BigNum.from_str('0');
                adaAmount = bnTransferValue;

            } else if (1 === bnInputCoinValue.compare(bnTransferValue)) {
                console.log("\n..parseTreasuryUtxoChangeData bnInputCoinValue is large than bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                let unitOutputAda = bnInputCoinValue.checked_sub(bnTransferValue).div_floor(bnOutputNum);
                console.log("\n..parseTreasuryUtxoChangeData unitOutputAda: ", bnOutputNum.to_str(), unitOutputAda.to_str());

                // if not enough for split, then not to balanced 
                if (-1 === unitOutputAda.compare(bnMinAda)) {
                    console.log("\n..parseTreasuryUtxoChangeData unitOutputAda is smaller than minAda: ", unitOutputAda.to_str(), bnMinAda.to_str());
                    marginAda = bnMinAda.checked_sub(unitOutputAda).checked_mul(bnOutputNum);
                    console.log("\n..parseTreasuryUtxoChangeData marginAda: ", marginAda.to_str());
                }
                adaAmount = bnTransferValue;

            } else {
                console.log("\n..parseTreasuryUtxoChangeData bnInputCoinValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                this.logger.debug("..parseTreasuryUtxoChangeData bnInputCoinValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                return undefined;
            }
            console.log("\n..parseTreasuryUtxoChangeData transfer ada: ", marginAda.to_str(), adaAmount.to_str(), bnOutputNum.to_str());

        } else {
            const tokenUnit = transferAmount.unit + "." + transferAmount.name;
            const minBindAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, this.paymentAddress, { coins: 0, assets: { [tokenUnit]: transferAmount.amount } }, datum);
            const bnMinBindAda = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(minBindAda));
            const bnInputAssetValue = totalInputAmount.asset.get(tokenUnit.replace(".", ""));
            const bnTransferValue = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(tokenAmount));

            if (0 === bnInputAssetValue.compare(bnTransferValue)) {
                bnOutputNum = CardanoWasm.BigNum.from_str('0');

                if (0 === bnInputCoinValue.compare(bnMinBindAda)) {
                    // bnOutputNum = CardanoWasm.BigNum.from_str('0');
                    adaAmount = bnMinBindAda;

                } else {
                    const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, this.paymentAddress, { coins: "10000000", assets: {} }, datum);
                    let bnMinAda = CardanoWasm.BigNum.from_str(this.commonUtil.number2String(minAda));

                    let changeAda = bnInputCoinValue.checked_sub(bnMinBindAda);
                    if (-1 === changeAda.compare(bnMinAda)) {
                        // in this case, changeAda should be filled in bindAda
                        adaAmount = bnInputCoinValue;
                    } else {
                        adaAmount = bnMinBindAda;
                    }
                }

            } else if (1 === bnInputAssetValue.compare(bnTransferValue)) {

                let changeBindAda = bnInputCoinValue.checked_sub(bnMinBindAda).div_floor(bnOutputNum);
                if (changeBindAda.less_than(bnMinBindAda)) {
                    marginAda = bnMinBindAda.checked_sub(changeBindAda).checked_mul(bnOutputNum);
                }

                adaAmount = bnMinBindAda;
            } else {
                console.log("\n..parseTreasuryUtxoChangeData bnInputAssetValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                this.logger.debug("..parseTreasuryUtxoChangeData bnInputAssetValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                return undefined;
            }

            console.log("\n..parseTreasuryUtxoChangeData transfer token: ", marginAda.to_str(), adaAmount.to_str(), bnOutputNum.to_str());
        }

        // TODO: need to parse minAda in case of token transfer
        let treasuryUtxoChangeInfo = {
            "marginAda": marginAda,
            "adaAmount": adaAmount.to_str(),
            "outputNum": parseInt(bnOutputNum.to_str())
        }
        console.log("\n..parseTreasuryUtxoChangeData result: ", treasuryUtxoChangeInfo);
        return treasuryUtxoChangeInfo;
    }


    async buildAndSignRawTx(internalSignFunc, basicArgs, tokenAmount, adaAmount, partialRedeemerArgs) {
        const to = basicArgs.crossAddress;
        const tokenId = basicArgs.tokenId;
        const metaData = basicArgs.metaData;
        const uniqueId = basicArgs.hashX;
        const userData = partialRedeemerArgs.userData; // cross Router 
        const addtionalAdaAmount = basicArgs.addtionalAdaAmount; // addtional ada for crossRoute 
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx current slot: ", this.curChainTip.slot);

        // Step 1: to get treasury data        
        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        //this.logger.debug("..PlutusTxBuilder...buildAndSignRawTx...groupInfoFromDatum...groupInfo: ", groupInfo);
        let treasuryCheckVH = groupInfo[contractsMgr.GroupNFT.TreasuryCheckVH];

        // Step 1-1: treasuryCheckRef&&Uxto 
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false,basicArgs.checkTokenUtxo);
        if (undefined == checkRefData) {
            throw "empty treasury check ref utxo  for uniqueId: " + uniqueId;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;

        // Step 1-2: treasury Ref utxo
        let treasuryRef = await this.getScriptRefUtxo(contracts.TreasuryScript.script());
        if (undefined === treasuryRef) {
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo");
            }
            throw "empty treasury ref utxo  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, `...transferValue Treasury ref utxo: ${treasuryRef.txHash + '#' + treasuryRef.index}`);

        // Step 2: to get treasury utxos for ccTask
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...this.lockerScAddress: ", this.lockerScAddress);

        // Step 2-1: to coin select treasury utxos for transfer
        let assetUnit = tokenId;
        let transferAmount = new Array();
        if (config.AdaTokenId === tokenId) {
            assetUnit = "lovelace";
            let amountItem = {
                "unit": "lovelace",
                "name": "",
                "amount": adaAmount
            };
            transferAmount.push(amountItem);
        } else {
            let [policyId, name] = tokenId.split(".");
            let extraTokenAmount = CardanoWasm.BigNum.from_str("1");
            let strTokenAmount = this.commonUtil.number2String(tokenAmount);
            let adjustedTokenAmount = CardanoWasm.BigNum.from_str(strTokenAmount).checked_add(extraTokenAmount);

            let amountItem = {
                "unit": policyId,
                "name": name,
                "amount": adjustedTokenAmount.to_str()
            };
            transferAmount.push(amountItem);
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...transferAmount: ", assetUnit, transferAmount);

        let contractUtxoRet = await this.getUtxoOfAmount(this.lockerScAddress, to, transferAmount, this.maxPlutusUtxoNum);
        if (undefined === contractUtxoRet) {
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo: ");
            }
            throw "failed to get treasury utxos for uniqueId: " + uniqueId;
        }

        let treasuryUtxo = contractUtxoRet.selectedUtxos;
        if (0 === treasuryUtxo.length) {
            // this.logger.debug("\n\n\n..PlutusTxBuilder...", uniqueId, "...mark forced merge status: ", tokenId);
            // to parse pending utxo ratio
            let formatedUtxos = this.commonUtil.formatUtxoData(contractUtxoRet.totalUtxos);

            let totalAssetUtxos = this.commonUtil.filterUtxosByAssetUnit(formatedUtxos, assetUnit);
            this.logger.debug("..PlutusTxBuilder......no target utxo selected :", assetUnit, totalAssetUtxos.length);
            if (0 === totalAssetUtxos.length) {
                this.logger.debug("..PlutusTxBuilder......no target utxo has been selected with asset utxo:", assetUnit, totalAssetUtxos.length);
                if(!basicArgs.checkTokenUtxo) {
                    this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo: ");
                    this.releaseUtxos(treasuryCheckUxto);
                }
                throw "insufficent treasury utxos for transfer for uniqueId: " + uniqueId;
            }

            let pendingUtxoRatio = this.parsePendingUtxoRatio(this.lockerScAddress, totalAssetUtxos);
            this.logger.debug("..PlutusTxBuilder......no target utxo selected with pendingUtxoRatio:", assetUnit, pendingUtxoRatio);
            if (pendingUtxoRatio >= parseFloat(config.BalancedCfg.maxPendingUtxoRatio)) {
                if(!basicArgs.checkTokenUtxo) {
                    this.releaseUtxos(treasuryCheckUxto);
                }
                throw "insufficent treasury utxos for transfer for uniqueId: " + uniqueId;
            }

            // to record forced balanced status: the-initial-slot && if-has-been-trigger
            this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Merge);
            let oldStatus = this.mapForcedBalancedStatus.get(assetUnit);
            if (oldStatus != undefined) {
                let delta = this.curChainTip.slot - oldStatus.initialSlot;
                if (delta > 300 || delta < -100) {
                    let forcedBalancedStatus = {
                        "initialSlot": this.curChainTip.slot,
                        "count": 1
                    };
                    this.mapForcedBalancedStatus.set(assetUnit, forcedBalancedStatus);
                }
            }
            else {
                let forcedBalancedStatus = {
                    "initialSlot": this.curChainTip.slot,
                    "count": 1
                };
                this.mapForcedBalancedStatus.set(assetUnit, forcedBalancedStatus);
            }

            // to mark forced balanced tag
            await this.markBalancedAsset(this.lockerScAddress, tokenId, this.curLatestBlock.time); //  

            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
            }
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo: ", treasuryCheckUxto);
            throw "insufficent treasury utxos for transfer  for uniqueId: " + uniqueId;
        }

        let bForcedBalancedStatus = false;
        let forcedBalancedStatus = this.mapForcedBalancedStatus.get(assetUnit);
        if (undefined !== forcedBalancedStatus) {
            let duration = this.curChainTip.slot - forcedBalancedStatus.initialSlot;
            let count = forcedBalancedStatus.count;

            bForcedBalancedStatus = (duration < config.BalancedCfg.maxForcedBalancedSlot && count > 0) ? true : false;
            forcedBalancedStatus.count = (count > 0) ? count - 1 : 0;
            this.mapForcedBalancedStatus.set(assetUnit, forcedBalancedStatus);
        }

        // Step 2-2: combine selectedUtxos with target balanced utxos
        //  this.logger.debug("..PlutusTxBuilder...", uniqueId, "...treasuryUtxo: ", treasuryUtxo);
        let balancedParseRet = {
            "coordinateUtxos": contractUtxoRet.selectedUtxos,
            "outputNum": config.BalancedCfg.defaultBalancedOutputNum
        };
        if (config.PlutusCfg.maxUtxoNum >= treasuryUtxo.length) {
            balancedParseRet = this.parseBalancedCoordinate(assetUnit, contractUtxoRet, bForcedBalancedStatus);
            treasuryUtxo = balancedParseRet.coordinateUtxos;
        }

        ////// Step 2-3: to get utxos for fee && collateral
        let treasuryUtxoChangeInfo = this.parseTreasuryUtxoChangeData(balancedParseRet, transferAmount[0], tokenAmount, userData);
        if (undefined === treasuryUtxoChangeInfo) {
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            }
            
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            throw "coin select treasury utxo amount is not enough for transferAmount  for uniqueId: " + uniqueId;
        }
        let txOutputNum = treasuryUtxoChangeInfo.outputNum;
        let marginAda = treasuryUtxoChangeInfo.marginAda;
        adaAmount = treasuryUtxoChangeInfo.adaAmount;

        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT).checked_add(marginAda);
        // addtional ada for crossRoute should be paid by leader
        if (undefined !== addtionalAdaAmount) {
            feeAmount = feeAmount.checked_add(CardanoWasm.BigNum.from_str(addtionalAdaAmount));
        }
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.getUtxoOfAmount(this.paymentAddress, to, feeValue, undefined);
        if (undefined === paymentUtxosRet) {
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            }
            throw "failed to get leader utxos for fee  for uniqueId: " + uniqueId;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            }
            throw "insufficent leader utxos for fee  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...utxosForFee: ", utxosForFee);

        //TODO：utxosForFee 应该是个数组?--fixed
        let validTTL = this.curChainTip.slot + config.MaxTxTTL;
        const nonce = { txHash: treasuryCheckUxto.txHash, index: treasuryCheckUxto.index };
        //TODO：tokenId 当为ada时，由华定义的是0x0000000000000000000000000000000000000000, --fixed
        //TODO：这里需要转换为空字符串才能被sdk识别。其他地方如果有类似的问题也得这么调整
        let assetUint = (config.AdaTokenId === tokenId) ? "" : tokenId;

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...convertSlotToTimestamp failed: ", err);

            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(treasuryCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            }
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee.");

            throw err;
        }

        const redeemerProof = {
            to, tokenId: assetUint, amount: tokenAmount, adaAmount,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '',
            pk: this.groupPK, txType: config.TaskType.crossTask, uniqueId: uniqueId,
            ttl: ttl2Ts, txTTL: validTTL, outputCount: txOutputNum, userData: userData, additionalAda: addtionalAdaAmount
        };
        this.logger.debug(".....PlutusTxBuilder...", uniqueId, "...redeemerProof: ", JSON.stringify(redeemerProof));


        try {
            const redeemProofHash = contracts.TreasuryScript.caculateRedeemDataHash(redeemerProof);
            this.logger.debug(".....PlutusTxBuilder...", uniqueId, "...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx internalSignFunc: ", signature);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx internalSignFunc exception: ", e);

            // this.releaseUtxos(treasuryCheckUxto);
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee.");

            throw e;
        }

        // Step 2: to build transfer value
        let assetAmount = (config.AdaTokenId === tokenId) ? {} : { [tokenId]: tokenAmount };
        let transferValue = { coins: adaAmount, assets: assetAmount };
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx transferValue: ", transferValue);

        try {
            const signedTxOutBound = await contracts.TreasuryScript.transferFromTreasury(this.protocolParams, utxosForFee,
                treasuryUtxo, treasuryRef, this.groupInfoToken, transferValue, to, redeemerProof, utxosForFee,
                treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this), this.signFn.bind(this), metaData,
                validTTL, txOutputNum);

            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx signedTxOutBound finished. ");
            return signedTxOutBound;

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx error: ", e);
            // do not release treasuryCheckUtxo, because it is used for nonce in redeemerProof and the mpc request may be broadcasted to all followers 
            // this.releaseUtxos(treasuryCheckUxto);
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee.");

            throw e;
        }
    }

    async buildAndSignMintRawTx(internalSignFunc, basicArgs, tokenAmount, partialRedeemerArgs) {
        const to = basicArgs.crossAddress;
        const tokenId = basicArgs.tokenId;
        const metaData = basicArgs.metaData;
        const uniqueId = basicArgs.hashX;
        const userData = partialRedeemerArgs.userData; // cross Router 
        const addtionalAdaAmount = basicArgs.addtionalAdaAmount; // addtional ada for crossRoute 
        this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx basicArgs: ", basicArgs);

        // Step 1: to get treasury data     
        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...groupInfoFromDatum...groupInfo: ", groupInfo);
        let mintCheckVH = groupInfo[contractsMgr.GroupNFT.MintCheckVH];
        // Step 1-1: treasuryCheckRef&&Uxto 
        let mintCheckRefData = await this.getTreasuryCheckRefAndAvailableUtxo(mintCheckVH, true, basicArgs.checkTokenUtxo);
        if (undefined == mintCheckRefData) {
            throw "empty mint check ref or utxo  for uniqueId: " + uniqueId;
        }
        let mintCheckUxto = mintCheckRefData.checkUtxo;
        let mintCheckRef = mintCheckRefData.checkRef;
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...mint check Treasury ref utxo: ", mintCheckUxto, mintCheckRef);

        // Step 1-2: treasury Ref utxo
        let mappingTokenRef = await this.getScriptRefUtxo(contracts.MappingTokenScript.script());
        if (undefined === mappingTokenRef) {
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(mintCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            }
            throw "empty mapping token script ref  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, `...transferValue Treasury ref utxo: ${mappingTokenRef.txHash + '#' + mappingTokenRef.index}`);

        // Step 2: to get leader utxos for mint fee
        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT);
        // addtional ada for crossRoute 
        if (undefined !== addtionalAdaAmount) {
            feeAmount = feeAmount.checked_add(CardanoWasm.BigNum.from_str(addtionalAdaAmount));
        }
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        this.logger.debug("..PlutusTxBuilder...", uniqueId, "...need feeValue: ", feeAmount.to_str());

        let paymentUtxosRet = await this.getUtxoOfAmount(this.paymentAddress, to, feeValue, undefined);
        if (undefined === paymentUtxosRet) {
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(mintCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            }
            throw "get leader utxos failed for mint tx fee  for uniqueId: " + uniqueId;
        }

        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(mintCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            }
            throw "insufficent leader utxos for mint tx fee  for uniqueId: " + uniqueId;
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
        //this.logger.debug("..PlutusTxBuilder...", uniqueId, "...utxos For Fee & Collateral: ", utxosForFee, collateralUtxos);

        //TODO：utxosForFee 应该是个数组?--fixed
        let validTTL = this.curChainTip.slot + config.MaxTxTTL;
        const nonce = { txHash: mintCheckUxto.txHash, index: mintCheckUxto.index };
        let assetUint = (config.AdaTokenId === tokenId) ? "" : tokenId;

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx convertSlotToTimestamp exception: ", err);

            if(!basicArgs.checkTokenUtxo) {
                this.releaseUtxos(mintCheckUxto);
                this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            }
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw err;
        }

        const redeemerProof = {
            to, tokenId: assetUint, amount: tokenAmount, txHash: nonce.txHash,
            index: nonce.index, mode: this.signMode, signature: '', uniqueId: uniqueId, ttl: ttl2Ts,
            txTTL: validTTL, userData: userData, additionalAda: addtionalAdaAmount
        };
        this.logger.debug(".....PlutusTxBuilder...", uniqueId, "...redeemerProof: ", JSON.stringify(redeemerProof));

        try {
            const redeemProofHash = contracts.MintCheckScript.caculateRedeemDataHash(redeemerProof);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx internalSignFunc exception: ", e);
            // this.releaseUtxos(mintCheckUxto);
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw e;
        }

        // Step 4: to build mint value
        try {
            const signedTxOutBound = await contracts.MappingTokenScript.mint(this.protocolParams, utxosForFee, collateralUtxos,
                mappingTokenRef, mintCheckRef, this.groupInfoToken, mintCheckUxto, redeemerProof, this.paymentAddress,
                this.evaluateFn.bind(this), this.signFn.bind(this), validTTL, metaData);

            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx...signedTxOutBound finished. ");
            return signedTxOutBound;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx error: ", e);
            // do not release treasuryCheckUtxo, because it is used for nonce in redeemerProof and the mpc request may be broadcasted to all followers 
            // this.releaseUtxos(treasuryCheckUxto);
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw e;
        }
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
        // to set asset balanced direction to split
        this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Split);

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

    parseBalancedCoordinate(assetUnit, treasuryUtxoRet, bForcedBalancedStatus) {
        if (undefined === treasuryUtxoRet) {
            return undefined;
        }

        let totalUtxos = treasuryUtxoRet.totalUtxos;
        let coordinateUtxos = treasuryUtxoRet.selectedUtxos;
        let ret = {
            "coordinateUtxos": coordinateUtxos,
            "outputNum": config.BalancedCfg.defaultBalancedOutputNum
        }

        let availableUtxos = this.checkAvailableUtxos(this.lockerScAddress, totalUtxos, false, assetUnit);
        if (undefined === availableUtxos) {
            // to set asset balanced direction to split
            let splitRet = this.confirmUtxoSplitCondition(assetUnit, totalUtxos, coordinateUtxos);
            if (undefined !== splitRet) {
                // in case split conditon is satisfied, return split result
                return splitRet;
            }
            // in case confirmRet is undefined, then just return default ret
            return ret;
        }

        let balancedOption = this.getPendingBalancedUtxosByUnit(availableUtxos, assetUnit);
        if (undefined === balancedOption) {
            return ret;
        }

        if (undefined === this.mapBalancedDirection.get(assetUnit)) {
            // if there is no balanced process for this assetUnit, then to check if need to trigger in this tasks
            if (balancedOption.assetUtxos.length > this.curBalancedParams.balancedCfg.utxoNumThresheld.maxUtxoListLen) {
                this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Merge);
                console.log("\n\n balanced direction: balancedType_Merge ", config.BalancedCfg.balancedType_Merge);

            } else if (balancedOption.assetUtxos.length < this.curBalancedParams.balancedCfg.utxoNumThresheld.minUtxoListLen) {
                if (bForcedBalancedStatus) {
                    return ret;
                }
                this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Split);
                console.log("\n\n balanced direction: balancedType_Split ", config.BalancedCfg.balancedType_Split);

            } else {
                console.log("\n\n balanced direction: no need to balanced ");
                return ret;
            }
        }

        let marginUtxoNum = config.PlutusCfg.maxUtxoNum - coordinateUtxos.length;
        console.log("\n\n balanced marginUtxoNum:", coordinateUtxos.length, marginUtxoNum);

        let balancedMode = undefined;
        let balancedDirection = this.mapBalancedDirection.get(assetUnit);
        if (config.BalancedCfg.balancedType_Merge === balancedDirection) {
            if (bForcedBalancedStatus) {
                balancedMode = config.BalancedCfg.mergePolicy_Desc;
            } else if ((balancedOption.assetUtxos.length - marginUtxoNum) < this.curBalancedParams.balancedCfg.utxoNumThresheld.idealUtxoListLen) {
                if ((balancedOption.assetUtxos.length - marginUtxoNum) < this.curBalancedParams.balancedCfg.utxoNumThresheld.minUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Split);

                } else {
                    this.mapBalancedDirection.set(assetUnit, undefined);
                    return ret;
                }
                return ret;
            } else {
                balancedMode = config.BalancedCfg.mergePolicy_Asc;
            }

        } else {
            if ((balancedOption.assetUtxos.length - marginUtxoNum) > this.curBalancedParams.balancedCfg.utxoNumThresheld.idealUtxoListLen) {
                this.mapBalancedDirection.set(assetUnit, undefined);
                return ret;
            } else {
                if (bForcedBalancedStatus) {
                    return ret;
                }
                balancedMode = undefined;
            }
        }
        console.log("\n\n balancedDirection...:", balancedMode, balancedDirection);

        if (config.BalancedCfg.balancedType_Split === balancedDirection) {
            let splitRet = this.confirmUtxoSplitCondition(assetUnit, totalUtxos, coordinateUtxos);
            if (undefined !== splitRet) {
                // in case split conditon is matched, return split result
                return splitRet;
            }
            // just return default ret
            return ret;

        } else if (0 === marginUtxoNum) {
            // if in merge direction and there is no need to fetch extral asset utxo, just return
            return ret;
        }

        // fetch extral asset utxo just for merge-balanced operation
        let retObj = this.getTargetBalancedUtxos(balancedOption, balancedMode, coordinateUtxos);
        console.log("\n\n getTargetBalancedUtxos...retObj:", retObj);
        if (undefined === retObj) {
            return ret;
        }

        // update selected utxos' status to pendingConsumed
        for (let i = 0; i < retObj.targetUtxos.length; i++) {
            let tmpTargetUtxo = retObj.targetUtxos[i];

            for (let j = 0; j < totalUtxos.length; j++) {
                let contractUtxo = totalUtxos[j];

                if ((contractUtxo.txHash === tmpTargetUtxo.txIn.txId)
                    && (contractUtxo.index === tmpTargetUtxo.txIn.index)) {
                    // to add to selected utxos array
                    coordinateUtxos.push(contractUtxo);
                }
            }
        }

        ret = {
            "coordinateUtxos": coordinateUtxos,
            "outputNum": retObj.outputNum
        }
        return ret;
    }

    async genRedeemProofHash(proofInfo) {
        try {
            if (undefined === this.groupInfoToken) {
                this.groupInfoToken = await this.getGroupInfoToken();
                // this.logger.debug("..PlutusTxBuilder......genRedeemProofHash()... init groupInfoToken: ", this.groupInfoToken);
                if (false === this.groupInfoToken) {
                    throw "network exception";
                }

                const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
                this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
            }

            let redeemerProof = {
                to: proofInfo.to,
                tokenId: (config.AdaTokenId === proofInfo.tokenId) ? "" : proofInfo.tokenId,
                amount: proofInfo.amount,
                adaAmount: proofInfo.adaAmount,
                txHash: proofInfo.txHash,
                index: proofInfo.index,
                mode: this.signMode,
                signature: '',
                pk: this.groupPK,
                txType: proofInfo.txType,
                uniqueId: proofInfo.uniqueId,
                ttl: proofInfo.ttl,
                outputCount: proofInfo.outputCount,
                userData: proofInfo.userData
            }
            // this.logger.debug("..PlutusTxBuilder......genRedeemProofHash redeemerProof: ", JSON.stringify(redeemerProof, null, 0))
            let redeemProofHash = contracts.TreasuryScript.caculateRedeemDataHash(redeemerProof);
            this.logger.debug("..PlutusTxBuilder......genRedeemProofHash caculateRedeemDataHash: ", redeemProofHash);

            return redeemProofHash;
        } catch (e) {
            this.logger.error("..PlutusTxBuilder...genRedeemProofHash...catch error : ", e);
            throw e;
        }
    }

    async genTokenRedeemProofHash(proofInfo) {
        try {
            if (undefined === this.groupInfoToken) {
                this.groupInfoToken = await this.getGroupInfoToken();
                // this.logger.debug("..PlutusTxBuilder......genRedeemProofHash()... init groupInfoToken: ", this.groupInfoToken);
                if (false === this.groupInfoToken) {
                    throw "network exception";
                }

                const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
                this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
            }

            let redeemerProof = {
                to: proofInfo.to,
                tokenId: (config.AdaTokenId === proofInfo.tokenId) ? "" : proofInfo.tokenId,
                amount: proofInfo.amount,
                adaAmount: proofInfo.adaAmount,
                txHash: proofInfo.txHash,
                index: proofInfo.index,
                mode: this.signMode,
                signature: '',
                pk: this.groupPK,
                uniqueId: proofInfo.uniqueId,
                ttl: proofInfo.ttl,
                userData: proofInfo.userData
            }
            // this.logger.debug("..PlutusTxBuilder......genRedeemProofHash redeemerProof: ", JSON.stringify(redeemerProof, null, 0))
            let redeemProofHash = contracts.MintCheckScript.caculateRedeemDataHash(redeemerProof);
            this.logger.debug("..PlutusTxBuilder......genTokenRedeemProofHash caculateRedeemDataHash: ", redeemProofHash);

            return redeemProofHash;
        } catch (e) {
            this.logger.error("..PlutusTxBuilder...genTokenRedeemProofHash...catch error : ", e);
            throw e;
        }
    }

    async confirmTx(txHash) {
        if (undefined === this.lockerScAddress) {
            let ret = await this.init();
            if (false === ret) {
                throw "failed to initial sdk!";
            }
        }
        // this.logger.debug("..PlutusTxBuilder...", txHash, "...confirmTx...lockerScAddress: ", this.lockerScAddress);

        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(this.lockerScAddress);
        if (undefined === mapConsumedUtxos) {
            // this.logger.debug("..PlutusTxBuilder...", txHash, "...confirmTx...no pending utxos for: ", this.lockerScAddress);
            return;
        }

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txHash);
            //  this.logger.debug("..PlutusTxBuilder...", txHash, "...confirmTx...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", txHash, "...confirmTx...get txsUtxos...error: ", e);
            throw e;
        }

        for (let j = 0; j < txUtxos.inputs.length; j++) {
            const tmp = txUtxos.inputs[j];

            if (tmp.address === this.lockerScAddress) {
                // to generate tx input based on txId&index
                let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(tmp.tx_hash, 'hex'));
                let txInput = CardanoWasm.TransactionInput.new(transaction_id, tmp.output_index);

                // to generate utxoId by txInput
                let utxoId = txInput.to_hex();
                // this.logger.debug("..PlutusTxBuilder...", txHash, "...confirmTx...pending list remove utxoId : ", utxoId);
                mapConsumedUtxos.delete(utxoId);
            }
        }

        // this.mapPendingConsumedUTXO.set(this.lockerScAddress, mapConsumedUtxos);
    }

    //////////////////////////////////
    //// Decode tx redeemer data
    //////////////////////////////////
    async deCodeTxRedeemersCbor(txInfo) {
        // this.logger.debug("..PlutusTxBuilder...", txInfo.hash, "...deCodeTxRedeemersCbor txInfo: ", txInfo);

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txInfo.hash);
            this.logger.debug("..PlutusTxBuilder", "...deCodeTxRedeemersCbor...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...deCodeTxRedeemersCbor...get txsUtxos...error: ", e);
            throw e;
        }

        const checkTokenPolicyId = contracts.TreasuryCheckTokenScript.policy_id();
        this.logger.debug("..PlutusTxBuilder...", "checkTokenPolicyId", checkTokenPolicyId);
        for (let i = 0; i < txUtxos.inputs.length; i++) {

            const tmpTxUtxo = txUtxos.inputs[i];
            // console.log("\n\n...deCodeTxRedeemersCbor...subInputObj: ", i, tmpTxUtxo);
            if (undefined === tmpTxUtxo.amount) {
                continue;
            }
            // Todo: to check token policyId
            for (let j = 0; j < tmpTxUtxo.amount.length; j++) {
                let assetItem = tmpTxUtxo.amount[j];
                let assetUnitInfo = assetItem.unit.split(".");

                if (checkTokenPolicyId === assetUnitInfo[0]) {
                    let redeemerKey = "spend:" + i;
                    let redeemerInfo = txInfo.redeemers[redeemerKey];
                    this.logger.debug("..PlutusTxBuilder", redeemerKey, redeemerInfo);
                    if (undefined === redeemerInfo) {
                        continue;
                    }

                    let redeemerCbor = redeemerInfo.redeemer;
                    this.logger.debug("..PlutusTxBuilder", "redeemerCbor", redeemerCbor);
                    // console.log("\n\n...deCodeTxRedeemersCbor...redeemerCbor: ", redeemerCbor);
                    return contracts.TreasuryScript.getRedeemerFromCBOR(redeemerCbor);
                }
            }
        }

        return undefined;
    }

    async deCodeTokenRedeemersCbor(txInfo) {
        // this.logger.debug("..PlutusTxBuilder...", txInfo.hash, "...deCodeTokenRedeemersCbor txInfo: ", txInfo);

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txInfo.hash);
            // this.logger.debug("..PlutusTxBuilder...deCodeTokenRedeemersCbor...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...deCodeTokenRedeemersCbor...get txsUtxos...error: ", e);
            throw e;
        }

        const mintCheckTokenPolicyId = contracts.MintCheckTokenScript.policy_id();
        for (let i = 0; i < txUtxos.inputs.length; i++) {

            const tmpTxUtxo = txUtxos.inputs[i];
            // console.log("\n\n...deCodeTokenRedeemersCbor...subInputObj: ", i, tmpTxUtxo);
            if (undefined === tmpTxUtxo.amount) {
                continue;
            }
            // Todo: to check token policyId
            for (let j = 0; j < tmpTxUtxo.amount.length; j++) {
                let assetItem = tmpTxUtxo.amount[j];
                let assetUnitInfo = assetItem.unit.split(".");

                if (mintCheckTokenPolicyId === assetUnitInfo[0]) {
                    let redeemerKey = "spend:" + i;
                    let redeemerInfo = txInfo.redeemers[redeemerKey];
                    if (undefined === redeemerInfo) {
                        continue;
                    }

                    let redeemerCbor = redeemerInfo.redeemer;
                    // console.log("\n\n...deCodeTokenRedeemersCbor...redeemerCbor: ", redeemerCbor);
                    return contracts.MintCheckScript.getRedeemerFromCBOR(redeemerCbor);
                }
            }
        }

        return undefined;
    }

    checkIfContainTreasuryUtxo(txInputUtxos) {
        let bContained = false;

        // to get treasury sc address
        if (undefined === this.lockerScAddress) {
            throw "failed to initial sdk!";
        }

        // to check if contains treasury utxos
        for (let i = 0; i < txInputUtxos.length; i++) {
            let utxoOwner = txInputUtxos[i].address;
            if (this.lockerScAddress === utxoOwner) {
                bContained = true;
                break;
            }
        }

        return bContained;
    }


    //////////////////////////////////
    //// Utxo Balanced Processing Funs
    //////////////////////////////////
    async markBalancedAsset(scAddress, assetUnit, curBlockSlot) {
        this.logger.debug("..PlutusTxBuilder...markBalancedAsset...", scAddress, assetUnit);
        if (undefined === this.mapScBalancedMarkRecord) {
            this.mapScBalancedMarkRecord = new Map();
        }

        if (undefined === curBlockSlot) {
            if (undefined === this.curLatestBlock) {
                await this.getCurChainParams();
            }
            curBlockSlot = this.curLatestBlock.time; //this.curChainTip.slot;
        }
        this.logger.debug("..PlutusTxBuilder...markBalancedAsset...", "curBlockSlot", curBlockSlot);

        // to convert asset unit to format unit
        if (config.AdaTokenId === assetUnit) {
            assetUnit = "lovelace";
        } else {
            // assetUnit = assetUnit.replace(".", "")
        }

        let scMarkRecord = this.mapScBalancedMarkRecord.get(scAddress);
        if (undefined === scMarkRecord) {
            scMarkRecord = new Map();
        }

        let assetMarkRecord = scMarkRecord.get(assetUnit);
        if (undefined === assetMarkRecord) {
            assetMarkRecord = {
                "markSlot": curBlockSlot,
                "mergeFlag": false,
                "mergeSlot": 0
            }
            scMarkRecord.set(assetUnit, assetMarkRecord);
            console.log("...markBalancedAsset...", assetUnit, assetMarkRecord);
            this.mapScBalancedMarkRecord.set(scAddress, scMarkRecord);
            this.logger.debug("..PlutusTxBuilder...markBalancedAsset...case1", scAddress, scMarkRecord);

        } else if (assetMarkRecord.markSlot < curBlockSlot) {
            assetMarkRecord.markSlot = curBlockSlot;
            scMarkRecord.set(assetUnit, assetMarkRecord);
            console.log("...markBalancedAsset...", assetUnit, assetMarkRecord);
            this.mapScBalancedMarkRecord.set(scAddress, scMarkRecord);
            this.logger.debug("..PlutusTxBuilder...markBalancedAsset...case2", scAddress, scMarkRecord);
        }

        this.logger.debug("..PlutusTxBuilder...", "markBalancedAsset...end", assetUnit);
    }

    parsePendingUtxoRatio(scAddress, availableUtxos) {
        let availableUtxosNum = availableUtxos.length;
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(scAddress);
        if (undefined === mapConsumedUtxos) {
            mapConsumedUtxos = new Map();
            this.mapPendingConsumedUTXO.set(scAddress, mapConsumedUtxos);
        }

        let pendingUtxoNum = 0;
        for (let i = 0; i < availableUtxos.length; i++) {
            let utxoObj = availableUtxos[i];
            let encUtxo = this.commonUtil.encodeUtxo(utxoObj);
            let utxoId = encUtxo.input().to_hex();

            if (mapConsumedUtxos.get(utxoId)) {
                pendingUtxoNum++;
            }
        }

        let pendingUtxoRatio = parseFloat(pendingUtxoNum * 100 / availableUtxosNum);
        return pendingUtxoRatio;
    }

    async fetchBalancedParams() {
        // step 2: to get lock 
        if ((undefined !== this.curBalancedParams)
            && ((this.curBalancedParams.activeSlot + config.BalancedCfg.configValidLatestSlot) >= this.curChainTip.slot)) {
            return true;
        }

        while (this.mapAccountLocker.get("balancedCfgLocker")) {
            await this.commonUtil.sleep(1000);
        }
        this.mapAccountLocker.set("balancedCfgLocker", true);

        if ((undefined === this.curBalancedParams)
            || ((this.curBalancedParams.activeSlot + config.BalancedCfg.configValidLatestSlot) < this.curChainTip.slot)) {
            try {
                let ret = await this.connector.getBalancedConfig();
                // this.logger.debug("..PlutusTxBuilder......getBalancedConfig ret: ", ret);
                this.curBalancedParams = {
                    "balancedCfg": ret.balancedConfig,
                    "activeSlot": this.curChainTip.slot
                }
                this.mapAccountLocker.set("balancedCfgLocker", false);

                return true;

            } catch (e) {
                this.logger.debug("..PlutusTxBuilder......getBalancedConfig failed: ", e);
                this.mapAccountLocker.set("balancedCfgLocker", false);
                return false;
            }
        }

        this.mapAccountLocker.set("balancedCfgLocker", false);
        return true;
    }

    async tryUtxosBalanced(internalSignFunc, paymentInfo, scAddress) {
        this.logger.debug("..PlutusTxBuilder......tryUtxosBalanced...begin: ");

        // Step 1: to build & sign & submit balanced tx        
        if (undefined === this.mapScBalancedMarkRecord) {
            this.mapScBalancedMarkRecord = new Map();
        }
        let mapScMarkRecord = this.mapScBalancedMarkRecord.get(scAddress);
        if (undefined === mapScMarkRecord) {
            this.logger.debug("\n\n...tryUtxosBalanced...there is no mark record for this round!");
            return undefined;
        }

        let bFetchChainParams = true;
        for (let assetUnit of mapScMarkRecord.keys()) {
            // assetMarkRecord = {
            //     "markSlot": curBlockSlot,
            //     "mergeFlag": false,
            //     "mergeSlot": 0
            // } 
            let assetMarkRecord = mapScMarkRecord.get(assetUnit);

            if ((undefined === assetMarkRecord)
                || (true === assetMarkRecord.mergeFlag)
                || (assetMarkRecord.mergeSlot >= assetMarkRecord.markSlot)) {
                this.logger.debug("..PlutusTxBuilder...invalid...markRecord:", assetUnit, assetMarkRecord);
                continue;
            }

            this.logger.debug("..PlutusTxBuilder......buildBalancedTx......assetUnit:", assetUnit);
            if (bFetchChainParams) {
                // Step 2: to get the latest net params
                let bRet = await this.getCurChainParams();
                if (false === bRet) {
                    this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...getCurChainParams...failed:");
                    return undefined;
                }

                bRet = await this.fetchBalancedParams();
                if (false === bRet) {
                    this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...fetchBalancedParams...failed.");
                    return undefined;
                }

                // to justify the paymentInfo param's validity
                if (undefined === paymentInfo.paymentSKey) {
                    this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...warning: invalidPaymentSkey");
                    return undefined;
                }
                this.paymentSkey = paymentInfo.paymentSKey;
                this.paymentAddress = paymentInfo.paymentAddress;

                // Step 1-3: to get group info and group pk
                let encodedGpk = this.commonUtil.encodeGpk(paymentInfo.gpk);
                if (this.groupPK !== encodedGpk) { // always refresh 'groupInfoToken'
                    this.groupInfoToken = await this.getGroupInfoToken();
                    // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getGroupInfoToken...: ", this.groupInfoToken);
                    if (false === this.groupInfoToken) {
                        return undefined; //config.ErrorDef.ErrorCode_NetworkException;
                    }

                    const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
                    // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...groupInfoFromDatum...groupInfo: ", groupInfo);
                    this.groupPK = groupInfo[contractsMgr.GroupNFT.GPK];
                    this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...groupInfoFromDatum...groupPK: ", this.groupPK);

                    if (this.groupPK !== encodedGpk) {
                        this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...getScriptRefUtxo...warning: inconsistent gpk");
                        return undefined;
                    }
                }

                bFetchChainParams = false;
            }

            // to update asset merge flag && merge slot
            assetMarkRecord.mergeFlag = true;
            assetMarkRecord.mergeSlot = assetMarkRecord.markSlot;
            mapScMarkRecord.set(assetUnit, assetMarkRecord);

            let bRetry = false;
            do {
                assetMarkRecord.mergeSlot = assetMarkRecord.markSlot;

                let assetBalancedRet = await this.tryAssetUtxosBalanced(internalSignFunc,
                    paymentInfo,
                    scAddress,
                    assetUnit);

                if (false === assetBalancedRet) {
                    bRetry = (assetMarkRecord.mergeSlot < assetMarkRecord.markSlot) ? true : false;
                    await this.commonUtil.sleep(500);
                } else {
                    bRetry = false;
                }

            } while (bRetry);

            // Step 3-7: to update asset merge flag && merge slot
            assetMarkRecord.mergeFlag = false;
            mapScMarkRecord.set(assetUnit, assetMarkRecord);
            this.logger.debug("\n\n..PlutusTxBuilder...finish asset merge: ", assetUnit, assetMarkRecord);

            // to update balanced record
            this.mapAssetBalancedTs.set(assetUnit, this.curChainTip.slot);
        }
    }

    async tryAssetUtxosBalanced(internalSignFunc, paymentInfo, scAddress, assetUnit) {
        // to set default merge mode as ascend
        let mode = config.BalancedCfg.mergePolicy_Asc;

        // Step 1: to get utxo with valid datum  
        let utxos = await this.getUtxo(scAddress); // null-datum utxos have been filtered
        if (0 === utxos.length) {
            this.logger.debug("\n\n...tryAssetUtxosBalanced...there is empty utxo for treasury sc!");
            return true;
        }
        this.logger.debug("\n\n...tryAssetUtxosBalanced...getUtxo: ", scAddress, utxos.length);

        // Step 2: to caculate pending ratio of asset utxo
        let formatedUtxos = this.commonUtil.formatUtxoData(utxos);
        let totalAssetUtxos = this.commonUtil.filterUtxosByAssetUnit(formatedUtxos, assetUnit);
        this.logger.debug("..tryAssetUtxosBalanced...filterUtxosByAssetUnit:", assetUnit, totalAssetUtxos.length);
        if (0 === totalAssetUtxos.length) {
            return true;
        }

        let pendingUtxoRatio = this.parsePendingUtxoRatio(scAddress, totalAssetUtxos);
        this.logger.debug("..tryAssetUtxosBalanced...pendingUtxoRatio:", assetUnit, pendingUtxoRatio);
        if (pendingUtxoRatio >= parseFloat(config.BalancedCfg.maxPendingUtxoRatio)) {
            return true;
        }

        // Step 3: to get available utxos, pendingConsumed/multi-asset utxos will be filtered
        let availableUtxos = this.checkAvailableUtxos(scAddress, utxos, false, assetUnit); // 
        if (undefined === availableUtxos) {
            this.logger.debug("\n\n...tryAssetUtxosBalanced...there is no available utxos for treasury sc!");
            return true;
        }
        // this.logger.debug("\n\n...tryAssetUtxosBalanced...checkAvailableUtxos: ", scAddress, JSON.stringify(availableUtxos));

        // Step 3-1: to get pending balanced utxos of asset
        let balancedOption = this.getPendingBalancedUtxosByUnit(availableUtxos, assetUnit);
        if (undefined === balancedOption) {
            // there is no available asset unit matched utxos
            return true;
        }
        // console.log("..PlutusTxBuilder...buildBalancedTx...balancedOption: ", assetUnit, balancedOption);

        // Step 3-2: to check mode
        let bForcedBalancedStatus = false;
        let forcedBalancedStatus = this.mapForcedBalancedStatus.get(assetUnit);
        if (undefined != forcedBalancedStatus) {

            let forceBalancedEndSlot = forcedBalancedStatus.initialSlot + config.BalancedCfg.maxForcedBalancedSlot;
            console.log("\n\n...mapForcedBalancedStatus...should to merge by forced: ", assetUnit, forcedBalancedStatus, forceBalancedEndSlot);
            let latestMergedSlot = this.mapAssetBalancedTs.get(assetUnit);
            latestMergedSlot = (undefined === latestMergedSlot) ? 0 : latestMergedSlot;

            if ((this.curChainTip.slot <= forceBalancedEndSlot) && (latestMergedSlot <= forcedBalancedStatus.initialSlot)) {
                mode = config.BalancedCfg.mergePolicy_Desc;
                this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Merge);
                console.log("\n\n...getTargetBalancedUtxos mapBalancedDirection: ", this.mapBalancedDirection.get(assetUnit));

                bForcedBalancedStatus = true;
            }
        }

        // 2023/06/27 modify: balancedParam N1/2/3 related to available utxos number
        if (!bForcedBalancedStatus) {
            console.log("\n\n...mapBalancedDirection: ", assetUnit, balancedOption.assetUtxos);
            if (undefined === this.mapBalancedDirection.get(assetUnit)) {
                if (balancedOption.assetUtxos.length >= this.curBalancedParams.balancedCfg.utxoNumThresheld.maxUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Merge);
                    console.log("\n\n...set BalancedDirection to merge: ", assetUnit, this.mapBalancedDirection.get(assetUnit));

                } else if (balancedOption.assetUtxos.length <= this.curBalancedParams.balancedCfg.utxoNumThresheld.minUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, config.BalancedCfg.balancedType_Split);
                    console.log("\n\n...set BalancedDirection to split: ", assetUnit, this.mapBalancedDirection.get(assetUnit));
                    // if need to split, then continue to process next asset
                    return true;

                } else {
                    // // in case no need to handle balance tx, then try utxo strip tx 
                    // if ("lovelace" !== assetUnit) {
                    //     this.logger.debug("\n\n..tryStripExtraBindAda...case 1: ");
                    //     await this.tryStripExtraBindAda(internalSignFunc, utxos, availableUtxos, assetUnit);
                    // }
                    return true;
                }
            }
            console.log("\n\n...mapBalancedDirection 1: ", assetUnit, this.mapBalancedDirection.get(assetUnit));

            let balancedDirection = this.mapBalancedDirection.get(assetUnit);
            if (config.BalancedCfg.balancedType_Merge === balancedDirection) {
                if (balancedOption.assetUtxos.length <= this.curBalancedParams.balancedCfg.utxoNumThresheld.idealUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, undefined);
                    // // in case no need to handle balance tx, then try utxo strip tx 
                    // if ("lovelace" !== assetUnit) {
                    //     this.logger.debug("\n\n..tryStripExtraBindAda...case 2: ");
                    //     await this.tryStripExtraBindAda(internalSignFunc, utxos, availableUtxos, assetUnit);
                    // }
                    return true;
                }

            } else {
                if (balancedOption.assetUtxos.length >= this.curBalancedParams.balancedCfg.utxoNumThresheld.idealUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, undefined);
                    // // in case no need to handle balance tx, then try utxo strip tx 
                    // if ("lovelace" !== assetUnit) {
                    //     this.logger.debug("\n\n..tryStripExtraBindAda...case 3: ");
                    //     await this.tryStripExtraBindAda(internalSignFunc, utxos, availableUtxos, assetUnit);
                    // }
                    return true;
                }
            }
            console.log("\n\n...mapBalancedDirection 2: ", assetUnit, this.mapBalancedDirection.get(assetUnit));
        }

        // in case of split direction, just return 
        if (config.BalancedCfg.balancedType_Split === this.mapBalancedDirection.get(assetUnit)) {
            return true;
        }

        // Step 3-3: to filter available utxo and update pending consumed status
        let rslt = this.getTargetBalancedUtxos(balancedOption, mode);
        if ((undefined === rslt.targetUtxos) || (0 === rslt.targetUtxos.length)) {
            return true;

        } else if (1 === rslt.targetUtxos.length) {
            let tmpBalancedUtxo = rslt.targetUtxos[0];
            let encUtxo = this.commonUtil.encodeUtxo(tmpBalancedUtxo);
            let utxoId = encUtxo.input().to_hex();

            let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(this.lockerScAddress);
            if (undefined === mapConsumedUtxos) {
                mapConsumedUtxos = new Map();
                this.mapPendingConsumedUTXO.set(this.lockerScAddress, mapConsumedUtxos);
            }
            mapConsumedUtxos.set(utxoId, undefined);

            return true;
        }
        // this.logger.debug("\n\n..tryAssetUtxosBalanced...", "...getTargetBalancedUtxos rslt: ",  JSON.stringify(rslt));

        // Step 4: to sign tx
        let signedTx = await this.buildBalancedTx(internalSignFunc, paymentInfo, utxos, rslt, assetUnit);
        console.log("\n\n...tryAssetUtxosBalanced buildBalancedTx signedTx: ", signedTx);
        if (undefined === signedTx) {
            return false;
        }

        // Step 5: to submit the signed tx
        try {
            let txId = await this.connector.sendRawTransaction(signedTx.to_bytes());
            this.logger.debug("..PlutusTxBuilder...tryAssetUtxosBalanced...sendRawTransaction :", txId);

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...tryAssetUtxosBalanced...sendRawTransaction error :", e);
            return false;
        }

        return true;
    }

    parseExtraBindAdaUtxos(totalUtxos, availableUtxos, assetUnit) {
        // to fetch the bind-ada strip config params
        const bindAdaStripCfg = this.curBalancedParams.balancedCfg.bindAdaStripCfg;
        const bnStrippedTreshold = CardanoWasm.BigNum.from_str(bindAdaStripCfg.strippedAdaThreshold); //30 ada
        const bnReservedValue = CardanoWasm.BigNum.from_str(bindAdaStripCfg.reservedAdaThreshold); //5 ada

        // to fetch utxo which should be stripped 
        let availableAssetUtxos = this.commonUtil.filterUtxosByAssetUnit(availableUtxos, assetUnit);
        for (let i = 0; i < availableAssetUtxos.length; i++) {
            let utxoValueAry = availableAssetUtxos[i].txOut.value;

            let bStripped = false;
            for (let j = 0; j < utxoValueAry.length; j++) {
                let bnExtraAmount = undefined;

                // to fetch bind-ada amount
                if ("lovelace" === utxoValueAry[j].unit) {
                    bnExtraAmount = CardanoWasm.BigNum.from_str(utxoValueAry[j].quantity);
                    if (0 < bnExtraAmount.compare(bnStrippedTreshold)) {
                        bStripped = true;
                    }
                }

                // to build strip record in case stripped utxo has been matched
                if (bStripped) {
                    // to mark pending Consumed status
                    let txId = availableAssetUtxos[i].txIn.txId;
                    let txIndex = availableAssetUtxos[i].txIn.index;

                    for (let k = 0; k < totalUtxos.length; k++) {
                        let utxo = totalUtxos[k];

                        if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                            // to add new pending consumed utxos
                            let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(this.lockerScAddress);
                            let encUtxo = this.commonUtil.encodeUtxo(availableAssetUtxos[i]);
                            let utxoId = encUtxo.input().to_hex();
                            mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                            this.mapPendingConsumedUTXO.set(this.lockerScAddress, mapConsumedUtxos);

                            // to return matched strip record
                            let ret = {
                                "targetUtxo": utxo,
                                "assetUnit": assetUnit,
                                "stripAmount": bnExtraAmount.checked_sub(bnReservedValue).to_str()
                            };
                            return ret;
                        }
                    }
                }
            }
        }

        return undefined;
    }

    async tryStripExtraBindAda(internalSignFunc, totalUtxos, availableUtxos, assetUnit) {
        // step 1: to check if this asset still in stripped status
        let lastStrippedSlot = this.mapAssetAdaSptrippedTs.get(assetUnit);
        if (undefined !== lastStrippedSlot) {
            const durationSlot = this.curChainTip.slot - lastStrippedSlot;
            const bindAdaStripCfg = this.curBalancedParams.balancedCfg.bindAdaStripCfg;
            if (bindAdaStripCfg.stripStatusDuration > durationSlot) {
                return;
            }
        }

        // step 2:  to parse binding ada's value
        let targetStripInfo = this.parseExtraBindAdaUtxos(totalUtxos, availableUtxos, assetUnit);
        this.logger.debug("..PlutusTxBuilder...trySplitExtraBindingAda...targetStripInfo:", targetStripInfo);
        if (undefined === targetStripInfo) {
            return;
        }

        // Step 3: to build & sign strip ada tx
        let signedTx = await this.buildAndSignAdaStripTx(internalSignFunc, targetStripInfo);
        console.log("\n\n...trySplitExtraBindingAda...signedTx: ", signedTx);
        if (undefined === signedTx) {
            return;
        }

        // Step 4: to submit the signed tx
        try {
            let txId = await this.connector.sendRawTransaction(signedTx.to_bytes());
            this.logger.debug("..PlutusTxBuilder......trySplitExtraBindingAda......sendRawTransaction :", txId);

            this.mapAssetAdaSptrippedTs.set(assetUnit, this.curChainTip.slot);

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder......trySplitExtraBindingAda......sendRawTransaction error :", e);
        }
        return;
    }

    async buildAndSignAdaStripTx(internalSignFunc, stripInfo) {
        this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...stripInfo:", stripInfo);
        // to check stripInfo validity
        if (undefined === stripInfo) {
            return undefined;
        }
        const treasuryUtxo = stripInfo.targetUtxo;
        const tokenId = stripInfo.assetUnit;
        const adaAmount = stripInfo.stripAmount;

        const bindAdaStripCfg = this.curBalancedParams.balancedCfg.bindAdaStripCfg;
        const txOutputNum = bindAdaStripCfg.stripTxOutputNum;
        const to = bindAdaStripCfg.foundationAddress;
        const metaData = "";
        const uniqueId = "";

        // Step 1: to get treasury data        
        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        let treasuryCheckVH = groupInfo[contractsMgr.GroupNFT.TreasuryCheckVH];

        // Step 1-1: treasuryCheckRef&&Uxto 
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        if (undefined == checkRefData) {
            this.releaseUtxos(treasuryUtxo);
            return undefined;//throw "empty treasury check ref utxo  for uniqueId: " + uniqueId;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;

        // Step 1-2: treasury Ref utxo
        let treasuryRef = await this.getScriptRefUtxo(contracts.TreasuryScript.script());
        if (undefined === treasuryRef) {
            this.releaseUtxos(treasuryUtxo);
            this.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo");

            return undefined;//throw "empty treasury ref utxo  for uniqueId: " + uniqueId;
        }

        // Step 2: to get treasury utxos for ccTask
        // Step 2-1: to coin select treasury utxos for transfer
        //to caculate transfer ada amount
        let transferAmount = new Array();
        let amountItem = {
            "unit": "lovelace",
            "name": "",
            "amount": adaAmount
        };
        transferAmount.push(amountItem);
        // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...amountItem: ", amountItem);

        ////// Step 2-2: to get utxos for fee && collateral
        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT);
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.getUtxoOfAmount(this.paymentAddress, to, feeValue, undefined);
        if ((undefined === paymentUtxosRet) || (0 === paymentUtxosRet.selectedUtxos.length)) {
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");

            return undefined; //throw "failed to get leader utxos for fee  for uniqueId: " + uniqueId;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...utxosForFee: ", utxosForFee);

        let validTTL = this.curChainTip.slot + config.MaxTxTTL;
        const nonce = { txHash: treasuryCheckUxto.txHash, index: treasuryCheckUxto.index };

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...convertSlotToTimestamp failed: ", err);

            this.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release utxosForFee.");

            return undefined;
        }

        const userData = this.commonUtil.genDemoDatum42().to_hex();
        const redeemerProof = {
            to, tokenId: tokenId, amount: 0, adaAmount,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '',
            pk: this.groupPK, txType: config.TaskType.crossTask, uniqueId: uniqueId,
            ttl: ttl2Ts, txTTL: validTTL, userData: userData, outputCount: txOutputNum
        };

        this.logger.debug(".....PlutusTxBuilder...buildAndSignAdaStripTx...redeemerProof: ", JSON.stringify(redeemerProof));

        try {
            let tmpPartialRedeemerArgs = {
                "hashKey": "",
                "crossTokenAddr": config.AdaTokenId,
                "amount": adaAmount,
                "fee": 0,
                "crossAddressHex": bindAdaStripCfg.foundationAddress
            };

            const redeemProofHash = contracts.TreasuryScript.caculateRedeemDataHash(redeemerProof);
            this.logger.debug(".....PlutusTxBuilder...buildAndSignAdaStripTx...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(tmpPartialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
            // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx internalSignFunc: ", signature);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx internalSignFunc exception: ", e);

            this.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release utxosForFee.");

            return undefined;
        }

        // Step 2: to build stripped ada value
        let transferValue = { coins: adaAmount, assets: {} };
        try {
            const signedTxOutBound = await contracts.TreasuryScript.transferFromTreasury(this.protocolParams, utxosForFee,
                treasuryUtxo, treasuryRef, this.groupInfoToken, transferValue, to, redeemerProof, utxosForFee,
                treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this), this.signFn.bind(this), metaData,
                validTTL, txOutputNum);

            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx signedTxOutBound finished. ");
            return signedTxOutBound;

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx error: ", e);

            this.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");
            this.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release utxosForFee.");

            return undefined;
        }
    }

    // to check the balanced utxos condition by address and tokenId
    getPendingBalancedUtxosByUnit(availableUtxos, assetUnit) {
        // to filter utxos by assetUnit
        let assetUtxos = this.commonUtil.filterUtxosByAssetUnit(availableUtxos, assetUnit);
        // this.logger.debug("..PlutusTxBuilder......buildBalancedTx......getPendingBalancedUtxosByUnit:", assetUnit, assetUtxos.length);
        if (0 === assetUtxos.length) {
            return undefined;
        }

        let balancedOption = {
            "assetUnit": assetUnit,
            "assetUtxos": assetUtxos
        };
        return balancedOption;
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

    // to filter input-existed utxos from balanced utxos list
    getTargetBalancedUtxos(balancedOption, mode, existInputUtxos = []) {
        if (undefined === balancedOption) {
            return;
        }

        let formatExistUtxos = this.commonUtil.formatUtxoData(existInputUtxos);
        // to sort balanced utxos
        console.log("\n\n...getTargetBalancedUtxos balancedOption.assetUtxos: ", balancedOption.assetUnit, balancedOption.assetUtxos);
        balancedOption.assetUtxos.sort(this.compareUtxoAssetValue(balancedOption.assetUnit).bind(this));

        let utxosLen = balancedOption.assetUtxos.length;
        let outputNum = 1;
        let targetUtxos = new Array();

        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(this.lockerScAddress);
        if (undefined === mapConsumedUtxos) {
            mapConsumedUtxos = new Map();
            this.mapPendingConsumedUTXO.set(this.lockerScAddress, mapConsumedUtxos);
        }

        // to fetch target utxos to build balanced tx
        console.log("\n\n...getTargetBalancedUtxos mapBalancedDirection: ", this.mapBalancedDirection.get(balancedOption.assetUnit));
        if (config.BalancedCfg.balancedType_Merge === this.mapBalancedDirection.get(balancedOption.assetUnit)) {
            // to get target utxos that need to merge            
            let selectedNum = 0;
            for (let i = 0; i < balancedOption.assetUtxos.length; i++) {
                if (selectedNum === (config.PlutusCfg.maxUtxoNum - existInputUtxos.length)) { // 
                    console.log("\n\n finish to select the right utxo to balanced");
                    break;
                }

                // config.PlutusCfg.maxUtxoNum
                let itemNo = i; // default policy: from min to max value
                if (config.BalancedCfg.mergePolicy_Desc === mode) {
                    itemNo = utxosLen - 1 - i; // descend policy: from max to min value
                }
                let tmpBalancedUtxo = balancedOption.assetUtxos[itemNo];

                // to filter exist utxo away from balanced array
                let bExist = false;
                for (let j = 0; j < formatExistUtxos.length; j++) {
                    if ((formatExistUtxos[j].txIn.txId === tmpBalancedUtxo.txIn.txId)
                        && (formatExistUtxos[j].txIn.index === tmpBalancedUtxo.txIn.index)) {
                        bExist = true;
                        break;
                    }
                }
                if (!bExist) {
                    targetUtxos.push(tmpBalancedUtxo);
                    selectedNum++;
                    console.log("\n\n...getTargetBalancedUtxos selected assetUtxo: ", selectedNum, tmpBalancedUtxo);

                    // to add new pending consumed utxos
                    let encUtxo = this.commonUtil.encodeUtxo(tmpBalancedUtxo);
                    let utxoId = encUtxo.input().to_hex();
                    mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                    this.mapPendingConsumedUTXO.set(this.lockerScAddress, mapConsumedUtxos);
                    this.logger.debug("..PlutusTxBuilder...", "getTargetBalancedUtxos...selected utxo object", utxoId);
                }
            }

        } else {
            // to get utxo object that need to split
            for (let i = utxosLen - 1; i >= 0; i--) {
                let bExist = false;
                let tmpBalancedUtxo = balancedOption.assetUtxos[i];

                for (let j = 0; j < formatExistUtxos.length; j++) {
                    if ((formatExistUtxos[j].txIn.txId === tmpBalancedUtxo.txIn.txId)
                        && (formatExistUtxos[j].txIn.index === tmpBalancedUtxo.txIn.index)) {
                        bExist = true;
                        break;
                    }
                }

                if (!bExist) {
                    targetUtxos.push(tmpBalancedUtxo);

                    // to add new pending consumed utxos
                    let encUtxo = this.commonUtil.encodeUtxo(tmpBalancedUtxo);
                    let utxoId = encUtxo.input().to_hex();
                    mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                    this.mapPendingConsumedUTXO.set(this.lockerScAddress, mapConsumedUtxos);

                    break;
                }
            }
            // to confirm splited output num
            if (0 === targetUtxos.length) {
                outputNum = config.BalancedCfg.minSpitedUtxoNum;
            } else {
                outputNum = config.BalancedCfg.minSpitedUtxoNum + 1;
            }
        }

        let ret = {
            "targetUtxos": targetUtxos,
            "outputNum": outputNum
        }

        return ret;
    }

    async buildBalancedTx(internalSignFunc, paymentInfo, totalUtxos, targetRet, assetUnit) {
        if (undefined === this.lockerScAddress) {
            // throw "failed to initial sdk!";
            return undefined;
        }

        // Step 1: to prepare 
        let targetUtxos = targetRet.targetUtxos;
        if (0 === targetUtxos.length) {
            return undefined;
        }
        let outputNum = targetRet.outputNum;

        let availableTargetUtxos = new Array();
        for (let i = 0; i < targetUtxos.length; i++) {
            let formateUtxo = targetUtxos[i];
            let txId = formateUtxo.txIn.txId;
            let txIndex = formateUtxo.txIn.index;

            for (let j = 0; j < totalUtxos.length; j++) {
                if ((txId === totalUtxos[j].txHash) && (txIndex === totalUtxos[j].index)) {
                    availableTargetUtxos.push(totalUtxos[j]);
                    break;
                }
            }
        }

        // Step 1: to get treasury data        
        const groupInfo = contractsMgr.GroupNFT.groupInfoFromDatum(this.groupInfoToken.datum);
        //this.logger.debug("..PlutusTxBuilder...buildAndSignRawTx...groupInfoFromDatum...groupInfo: ", groupInfo);
        let treasuryCheckVH = groupInfo[contractsMgr.GroupNFT.TreasuryCheckVH];

        // Step 1-1: to get treasury check ref and utxo
        // let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(contracts.TreasuryCheckScript, false);
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        if (undefined == checkRefData) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getTreasuryCheckRefAndAvailableUtxo...warning: EmptyCheckUtxo");
            this.releaseUtxos(availableTargetUtxos);
            return undefined;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;

        // Step 1-2: to get treasury ref and utxo
        let treasuryRef = await this.getScriptRefUtxo(contracts.TreasuryScript.script());
        if (undefined === treasuryRef) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getScriptRefUtxo...warning:.EmptyScriptRefUtxo");
            this.releaseUtxos(treasuryCheckUxto);
            this.releaseUtxos(availableTargetUtxos);
            return undefined;
        }
        // this.logger.debug(`..PlutusTxBuilder...buildBalancedTx...transferValue Treasury ref utxo: ${treasuryRef.txHash + '#' + treasuryRef.index}`);

        // Step 1-4: to caculate the total assert value of targetUtxos
        let balancedValue = this.caculateInputValue(targetUtxos);
        if (CardanoWasm.BigNum.from_str('0') === balancedValue.coin) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getScriptRefUtxo...warning: insufficent utxos");
            this.releaseUtxos(treasuryCheckUxto);
            this.releaseUtxos(availableTargetUtxos);
            return undefined;
        }
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...balancedValue: ", balancedValue);

        // Step 2: to caculate the max fee for balanced tx, on leader account.
        let feeValue = new Array();
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": parseInt(LEADER_FEE_AMOUNT)
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.getUtxoOfAmount(this.paymentAddress, this.lockerScAddress, feeValue, undefined);
        if (undefined === paymentUtxosRet) {
            this.releaseUtxos(treasuryCheckUxto);
            this.releaseUtxos(availableTargetUtxos);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getUtxoOfAmount...warning: get UtxoForFee failed");
            return undefined;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.releaseUtxos(treasuryCheckUxto);
            this.releaseUtxos(availableTargetUtxos);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getUtxoOfAmount...warning: inSufficent Utxo For Fee");
            return undefined;
        }
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...utxosForFee: ", utxosForFee);

        // Step 3: add tx input based on utxo data  
        let validTTL = this.curChainTip.slot + config.MaxTxTTL;
        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            return undefined;
        }
        // this.logger.debug("..PlutusTxBuilder......buildBalancedTx...validTTL: ", validTTL);

        const nonce = { txHash: treasuryCheckUxto.txHash, index: treasuryCheckUxto.index };
        const tokenAmount = "0"; // ("lovelace" === assetUnit) ? 0 : balancedValue.asset.get(assetUnit.replace(".", "")).to_str();
        const tokenId = ("lovelace" === assetUnit) ? "" : assetUnit;
        // this.logger.debug("..PlutusTxBuilder......buildBalancedTx...tokenAmount: ", assetUnit, tokenAmount);
        const adaAmount = "0"; // balancedValue.coin.to_str();
        const userData = this.commonUtil.genDemoDatum42().to_hex();
        const redeemerProof = {
            to: this.lockerScAddress, tokenId: tokenId, amount: tokenAmount, adaAmount,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '', pk: this.groupPK,
            txType: config.TaskType.balancedTask, uniqueId: "", ttl: ttl2Ts, txTTL: validTTL,
            userData: userData, outputCount: outputNum
        };
        this.logger.debug(".....PlutusTxBuilder...buildBalancedTx...redeemerProof: ", JSON.stringify(redeemerProof));

        try {
            // add mpc inner sign
            const redeemProofHash = contracts.TreasuryScript.caculateRedeemDataHash(redeemerProof);
            this.logger.debug(".....PlutusTxBuilder...buildBalancedTx...caculateRedeemDataHash: ", redeemProofHash);

            let tmpPartialRedeemerArgs = {
                "hashKey": "",
                "crossTokenAddr": ("lovelace" === assetUnit) ? config.AdaTokenId : assetUnit,
                "amount": ("lovelace" === assetUnit) ? adaAmount : tokenAmount,
                "fee": 0,
                "crossAddressHex": this.lockerScAddress
            };

            let signature = await internalSignFunc(tmpPartialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx internalSignFunc exception: ", e);
            this.releaseUtxos(availableTargetUtxos);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx release availableTargetUtxos.");
            this.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx release treasuryCheckUxto.");
            this.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx release utxosForFee.");
            return undefined;
        }

        // Step 4: to build transaction with related params
        let assetItem = ("lovelace" === assetUnit) ? {} : { [assetUnit]: tokenAmount }
        let transferValue = { coins: adaAmount, assets: assetItem };
        // this.logger.debug("..PlutusTxBuilder......buildBalancedTx...transferValue: ", assetUnit, transferValue);

        let metaData = {
            // empty metaData info is just ok
        };

        try {
            const signedTxOutBound = await contracts.TreasuryScript.transferFromTreasury(this.protocolParams, utxosForFee,
                availableTargetUtxos, treasuryRef, this.groupInfoToken, transferValue, this.lockerScAddress, redeemerProof,
                utxosForFee, treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this),
                this.signFn.bind(this), metaData, validTTL, outputNum);

            return signedTxOutBound;

        } catch (e) {
            this.logger.error("..PlutusTxBuilder......transferFromTreasury...e: ", e);
            this.releaseUtxos(availableTargetUtxos);
            this.releaseUtxos(treasuryCheckUxto);
            this.releaseUtxos(utxosForFee);
            return undefined; //throw e;
        }
    }

    caculateInputValue(targetUtxos) {
        let inputAdaValue = CardanoWasm.BigNum.from_str('0');
        let mapInputTokenValue = new Map();

        for (let i = 0; i < targetUtxos.length; i++) {
            // console.log("\n\n...caculateInputValue: ", targetUtxos[i], targetUtxos[i].txIn, targetUtxos[i].txOut);
            let itemValue = targetUtxos[i].txOut.value;

            for (let j = 0; j < itemValue.length; j++) {
                // console.log("\n...caculateInputValue: ", itemValue[j].unit, itemValue[j].quantity);

                if ("lovelace" === itemValue[j].unit) {
                    let bnAssetAmount = CardanoWasm.BigNum.from_str(itemValue[j].quantity);
                    inputAdaValue = inputAdaValue.checked_add(bnAssetAmount);

                } else {
                    let tmpAmount = CardanoWasm.BigNum.from_str(itemValue[j].quantity);
                    let bnAssetValue = mapInputTokenValue.get(itemValue[j].unit);
                    if (undefined === bnAssetValue) {
                        bnAssetValue = CardanoWasm.BigNum.from_str('0');
                    }

                    bnAssetValue = bnAssetValue.checked_add(tmpAmount);
                    mapInputTokenValue.set(itemValue[j].unit, bnAssetValue);
                }
            }
        }

        let inputValue = {
            "coin": inputAdaValue,
            "asset": mapInputTokenValue
        };

        console.log("\n...caculateInputValue ret: ", inputValue);
        return inputValue;
    }

    async getTreasuryCheckRefAndAvailableUtxo(checkVH, bMintCheck, checkTokenUtxo = undefined) {
        // Step 1: treasuryCheckRefUtxo
        let treasuryCheckRef = await this.getScriptRefUtxoByVH(checkVH);// contracts.TreasuryCheckScript.script()
        if (undefined === treasuryCheckRef) {
            this.logger.debug("..PlutusTxBuilder...getScriptRefUtxo...error:: no available check ref utxo");
            return undefined;
        }

        // Step 2: treasuryCheckUxto  : to monitor this script check utxos
        let scriptCheckRefAddress = await this.getTreasuryCheckAddress(bMintCheck);
        let treasuryCheckUxto;
        if(checkTokenUtxo === undefined) {
            treasuryCheckUxto = await this.getScriptCheckRefAvailableUtxo(scriptCheckRefAddress);
        }else {
            //if the checkTokenUtxo is provided, we will use it directly and reset its expired time
            treasuryCheckUxto = checkTokenUtxo;
            this.resetUtxoExpiredTime(scriptCheckRefAddress, treasuryCheckUxto.txHash, treasuryCheckUxto.index);
        }

        if (undefined === treasuryCheckUxto) {
            this.logger.debug("..PlutusTxBuilder...getScriptCheckRefAvailableUtxo...warning:: no available check utxo");
            return undefined;
        }

        let ret = {
            "checkUtxo": treasuryCheckUxto,
            "checkRef": treasuryCheckRef
        }
        return ret;
    }

    _clearExpiredPendingCheckTokenUtxos(scriptCheckRefAddress) {
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(scriptCheckRefAddress);
        let clearCount = 0;
        if (undefined === mapConsumedUtxos) {
            return clearCount;
        }

        let maxPendingTTL = config.MaxConsumedCheckUtxoTTL;

        for (let key of mapConsumedUtxos.keys()) {
            let consumedInitialSlot = mapConsumedUtxos.get(key);
            let durSlot = this.curChainTip.slot - consumedInitialSlot;
            if (maxPendingTTL <= durSlot) {
                mapConsumedUtxos.delete(key);
                clearCount++;
            }

            this.mapPendingConsumedUTXO.set(scriptCheckRefAddress, mapConsumedUtxos);
        }

        return clearCount;
    }

    async getTreasuryCheckUtxosTotalNum(bMintCheck) {
        let scriptCheckRefAddress = await this.getTreasuryCheckAddress(bMintCheck);
        let availableCheckUtxoCount = 0;

        // to clear expired pending checkToken utxos before caculate available checkToken utxos
        this._clearExpiredPendingCheckTokenUtxos(scriptCheckRefAddress);

        let utxos = await this.getUtxo(scriptCheckRefAddress, false);
        this.logger.debug("..PlutusTxBuilder...check utxos num: ", scriptCheckRefAddress, utxos.length);
        for (let i = 0; i < utxos.length; i++) {
            let utxoItem = {
                "txId": utxos[i].txHash,
                "index": utxos[i].index
            }
            this.logger.debug(`..PlutusTxBuilder...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
            let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoItem.txId, 'hex'));
            let txInput = CardanoWasm.TransactionInput.new(transaction_id, utxoItem.index);

            // to generate utxoId by txInput
            let utxoId = txInput.to_hex();
            this.logger.debug(`..PlutusTxBuilder..getTreasuryCheckUtxosTotalNum...to match Key: ${utxoId}`);

            let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(scriptCheckRefAddress);
            if (mapConsumedUtxos && mapConsumedUtxos.get(utxoId)) {
                this.logger.debug(`..PlutusTxBuilder..utxoId: #${utxoId} in pendingUtxo of address: ${scriptCheckRefAddress}`);
                continue;
            };

            availableCheckUtxoCount++;
        }

        // to format utxos
        let formatUtxos = this.commonUtil.formatUtxoData(utxos);
        // to filt valid policyId checkToken
        let validCheckTokenUtxos = this.fiterValidCheckTokenUtxos(formatUtxos);
        // to caculate invalid checkToken num
        let inValidUtxoNum = utxos.length - validCheckTokenUtxos.length;
        if (inValidUtxoNum > 0) {
            // to adjust availableCheckUtxoCount
            availableCheckUtxoCount = availableCheckUtxoCount - inValidUtxoNum;
            this.logger.debug(`..PlutusTxBuilder...${scriptCheckRefAddress} takes ${inValidUtxoNum} invalid policyId token.`);
        }

        this.logger.debug("..PlutusTxBuilder...availalbe check utxos num: ", bMintCheck, scriptCheckRefAddress, availableCheckUtxoCount);
        return availableCheckUtxoCount;
    }

}


module.exports = PlutusTxBuilder;







