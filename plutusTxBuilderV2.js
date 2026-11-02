const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const Common = require('./util/common');
const Config = require('./config');
const Cbor = require('cbor-sync');
const UtxoSelectionService = require('./bizServices/utxoSelectionService');
const UtxoSplitService = require('./bizServices/utxoSplitService');
const AdaExtraService = require('./bizServices/adaExtraService');
const ContractService = require('./bizServices/contractService');

class PlutusTxBuilder {

    constructor(chainConnector, scriptRefOwnerAddr, utxosManager, logUtil, bMainnet) {
        this.connector = chainConnector;
        this.scriptRefOwnerAddr = scriptRefOwnerAddr;
        // this.collateralAmount = Config.PlutusCfg.collateralAmount;
        this.bMainnet = bMainnet;
        this.utxosManagerObj = utxosManager;

        this.ADDR_PREFIX = Config.PlutusCfg.testnetPrefix;
        this.network_id = CardanoWasm.NetworkInfo.testnet_preprod().network_id();
        if (bMainnet) {
            this.ADDR_PREFIX = Config.PlutusCfg.mainnetPrefix;
            this.network_id = CardanoWasm.NetworkInfo.mainnet().network_id();
        }
        this.maxPlutusUtxoNum = Config.PlutusCfg.maxUtxoNum;

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
        this.commonUtil = new Common(this.ADDR_PREFIX);
        this.utxoSelectionService = new UtxoSelectionService(this.ADDR_PREFIX);
        this.utxoSplitService = new UtxoSplitService(this.ADDR_PREFIX);
        this.adaExtraService = new AdaExtraService(this.ADDR_PREFIX);
        this.contractService = new ContractService(bMainnet, this.ADDR_PREFIX, logUtil);

        this.validCheckTokenPolicyId = this.contractService.validCheckTokenPolicyId;
        this.validMappingCheckTokenPolicyId = this.contractService.validMappingCheckTokenPolicyId;
        this.logger = logUtil;

        this.memScriptRefUtxos = new Array();
    }

    init() {
        // let stakeCred = await this.getGroupInfoStkVh();
        // this.lockerScAddress = this.contractService.getLockerScAddress(stakeCred);
        this.lockerScAddress = this.bMainnet ? config.MainNet.TreasuryScAddress : config.TestNet.TreasuryScAddress;
        if (undefined === this.lockerScAddress) {
            return false;
        }
        console.log("\n\n\n\******* this.lockerScAddress: ", this.lockerScAddress);

        this.signMode = this.contractService.getSignMode();
        this.validPolicyId = this.contractService.getValidPolicyId();
        this.utxosManagerObj.setTreasuryScAddress(this.lockerScAddress);

        return true;
    }

    getCheckTokenPolicyId() {
        return this.validCheckTokenPolicyId;
    }

    getMintCheckTokenPolicyId() {
        return this.validMappingCheckTokenPolicyId;
    }

    //////////////////////////////////////////
    //// PART 1: plutus contracts related api
    //////////////////////////////////////////
    async genRedeemProofHash(proofInfo) {
        try {
            if (undefined === this.groupInfoToken) {
                this.groupInfoToken = await this.getGroupInfoToken();
                // this.logger.debug("..PlutusTxBuilder......genRedeemProofHash()... init groupInfoToken: ", this.groupInfoToken);
                if (false === this.groupInfoToken) {
                    throw "network exception";
                }

                this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
            }

            let redeemerProof = {
                to: proofInfo.to,
                tokenId: (Config.AdaTokenId === proofInfo.tokenId) ? "" : proofInfo.tokenId,
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
            let redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, false);
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

                this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
            }

            let redeemerProof = {
                to: proofInfo.to,
                tokenId: (Config.AdaTokenId === proofInfo.tokenId) ? "" : proofInfo.tokenId,
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
            let redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, true);
            this.logger.debug("..PlutusTxBuilder......genTokenRedeemProofHash caculateRedeemDataHash: ", redeemProofHash);

            return redeemProofHash;
        } catch (e) {
            this.logger.error("..PlutusTxBuilder...genTokenRedeemProofHash...catch error : ", e);
            throw e;
        }
    }

    async deCodeTxRedeemersCbor(txInfo, bMintCheck) {
        // this.logger.debug("..PlutusTxBuilder...", txInfo.hash, "...deCodeTxRedeemersCbor txInfo: ", txInfo);

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txInfo.hash);
            // this.logger.debug("..PlutusTxBuilder...deCodeTxRedeemersCbor...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...deCodeTxRedeemersCbor...get txsUtxos...error: ", e);
            throw e;
        }

        let redeemer = this.contractService.deCodeTxRedeemersCbor(txInfo, txUtxos, bMintCheck);
        return redeemer;
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

    async getTreasuryCheckRefAndAvailableUtxo(checkVH, bMintCheck) {
        // Step 1: treasuryCheckRefUtxo
        let treasuryCheckRef = await this.getScriptRefUtxoByVH(checkVH);
        if (undefined === treasuryCheckRef) {
            this.logger.debug("..PlutusTxBuilder...getScriptRefUtxo...error:: no available check ref utxo");
            return undefined;
        }

        // Step 2: treasuryCheckUxto  : to monitor this script check utxos
        let scriptCheckRefAddress = await this.getTreasuryCheckAddress(bMintCheck);
        let treasuryCheckUxto = await this.getScriptCheckRefAvailableUtxo(scriptCheckRefAddress);
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

    async getTreasuryCheckUtxosTotalNum(bMintCheck) {
        let scriptCheckRefAddress = await this.getTreasuryCheckAddress(bMintCheck);
        let availableCheckUtxoCount = 0;

        let utxos = await this.utxosManagerObj.getUtxo(scriptCheckRefAddress, false);
        for (let i = 0; i < utxos.length; i++) {
            let utxoItem = {
                "txId": utxos[i].txHash,
                "index": utxos[i].index
            }
            // this.logger.debug(`..PlutusTxBuilder...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
            let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoItem.txId, 'hex'));
            let txInput = CardanoWasm.TransactionInput.new(transaction_id, utxoItem.index);

            // to generate utxoId by txInput
            let utxoId = txInput.to_hex();
            // this.logger.debug(`..PlutusTxBuilder..getTreasuryCheckUtxosTotalNum...to match Key: ${utxoId}`);

            let mapConsumedUtxos = this.utxosManagerObj.getPendingComsumedUtxoByAddress(scriptCheckRefAddress);
            if (mapConsumedUtxos.get(utxoId)) {
                // this.logger.debug(`..PlutusTxBuilder..release utxoId: #${utxoId} in pendingUtxo of address: ${address}`);
                continue;
            };

            availableCheckUtxoCount++;
        }

        this.logger.debug("..PlutusTxBuilder...availalbe check utxos num: ", bMintCheck, scriptCheckRefAddress, availableCheckUtxoCount);
        return availableCheckUtxoCount;
    }

    async getScriptCheckRefAvailableUtxo(scriptCheckRefAddress) {

        let utxos = await this.utxosManagerObj.getUtxo(scriptCheckRefAddress, false);
        this.logger.debug("..PlutusTxBuilder......get scriptCheckRef utxos: ", scriptCheckRefAddress, utxos.length);
        if (0 === utxos.length) {
            this.logger.debug("..PlutusTxBuilder.....warning: get no scriptCheckRef utxos.");
            return undefined;
        }

        let availableUtxos = this.utxosManagerObj.checkAvailableUtxos(scriptCheckRefAddress, utxos, true);
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
                this.utxosManagerObj.appendPendingComsumedUtxo(scriptCheckRefAddress, validCheckTokenUtxos[0], this.curChainTip.slot);

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
            if ((this.validCheckTokenPolicyId === tokenPolicyId)
                || (this.validMappingCheckTokenPolicyId === tokenPolicyId)) {
                bContainCheckToken = true;
                break;
            }
        }

        return bContainCheckToken;
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

    getLockerScAddress() {
        // this.lockerScAddress = this.contractService.getLockerScAddress(stakeCred);
        return this.lockerScAddress;
    }

    getValidPolicyId() {
        // this.validPolicyId = this.contractService.getValidPolicyId();
        return this.validPolicyId
    }

    addressToPkhOrScriptHash(address) {
        let phk = this.contractService.addressToPkhOrScriptHash(address);
        return phk;
    }

    async getGroupInfoToken() {

        const groupInfo = this.contractService.getGroupInfoHolder();
        const groupInfoHolder = groupInfo.groupHolder;
        const expectedTokenId = groupInfo.tokenId;

        const groupInfoToken = (await this.utxosManagerObj.getUtxo(groupInfoHolder)).find(o => {
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
            throw "getGroupInfoStkVh exception network during get group info token";
        }

        let StkVh = this.contractService.getGroupInfoStkVh(this.groupInfoToken.datum);
        //this.logger.debug("..PlutusTxBuilder......groupInfoFromDatum...StkVh: ", StkVh);
        return StkVh;
    }

    async getTreasuryCheckAddress(bMintCheck) {
        this.groupInfoToken = await this.getGroupInfoToken();
        // this.logger.debug("..PlutusTxBuilder......getGroupInfoToken...: ", this.groupInfoToken);
        if (false === this.groupInfoToken) {
            throw "getTreasuryCheckAddress exception network during get group info token";
        }

        let checkAddress = this.contractService.getTreasuryCheckAddress(bMintCheck, this.groupInfoToken.datum);
        return checkAddress;
    }

    //////////////////////////////////////////////////////
    //// PART 2: to fetch online data from ogmios service
    //////////////////////////////////////////////////////
    async convertSlotToTimestamp(slot) {
        try {
            const eraSummaries = await this.connector.queryEraSummaries();
            const genisis = await this.connector.queryGenesisConfig();

            return this.commonUtil.slotToTimestamp(slot, eraSummaries, genisis);

        } catch (err) {
            throw `convertSlotToTimestamp failed:  ${err}`;
        }
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
            && ((this.curChainTip.slot + Config.ChainStatusValidLatestSlot) > latestChainTip.slot)) {
            return true;
        }

        while (this.mapAccountLocker.get("latestChainStatusLocker")) {
            await this.commonUtil.sleep(1000);
        }

        this.mapAccountLocker.set("latestChainStatusLocker", true);

        if ((undefined === this.curChainTip)
            || ((this.curChainTip.slot + Config.ChainStatusValidLatestSlot) <= latestChainTip.slot)) {
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

    ///modify_2.21: add new valid asset tyep interface
    addSupportedAssetType(tokenId) {
        this.mapValidAssetType.set(tokenId, true);
    }

    revertUtxoPendingComsumedStatus(inputUtxos) {
        this.utxosManagerObj.revertUtxoPendingComsumedStatus(inputUtxos);
    }

    async confirmTx(txHash) {
        if (undefined === this.lockerScAddress) {
            let ret = await this.init();
            if (false === ret) {
                throw "failed to initial sdk!";
            }
        }
        // this.logger.debug("..PlutusTxBuilder...", txHash, "...confirmTx...lockerScAddress: ", this.lockerScAddress);

        let mapConsumedUtxos = this.utxosManagerObj.getPendingComsumedUtxoByAddress(this.lockerScAddress);
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
                // mapConsumedUtxos.delete(utxoId);
                this.utxosManagerObj.deletePendingComsumedUtxoById(this.lockerScAddress, utxoId);
            }
        }
    }


    ////////////////////////////////////////////
    //// PART 3: build cross-chain tx raw data
    ////////////////////////////////////////////
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

        this.utxosManagerObj.setSmgLeaderAddress(this.paymentAddress);
        this.utxosManagerObj.setTreasuryScAddress(this.lockerScAddress);

        //Step 1: to get groupInfoToken and fetch group pk
        let encodedGpk = this.commonUtil.encodeGpk(basicArgs.gpk);
        // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...this.groupInfoToken: ", this.groupInfoToken);
        if (this.groupPK !== encodedGpk) {
            this.groupInfoToken = await this.getGroupInfoToken();
            //this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getGroupInfoToken...: ", this.groupInfoToken);
            if (false === this.groupInfoToken) {
                throw "buildSignedTx exception network during get group info token";
            }

            this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
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
        this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...basicArgs: ", basicArgs);

        // to confirm transfer asset value
        let adaAmount = 0;
        let tokenAmount = 0;
        const datum = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        if (Config.AdaTokenId === tokenId) {
            adaAmount = ccTaskAmount;
            const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, owner, { coins: adaAmount, assets: {} }, datum);
            this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getMinAdaOfUtxo: ", minAda, typeof (minAda));

            if (adaAmount < minAda) {
                this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...adaAmount: ", adaAmount, typeof (adaAmount));
                throw 'lt than minAda';
            }
        } else {
            tokenAmount = ccTaskAmount;
            const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams, owner, { coins: 0, assets: { [tokenId]: tokenAmount } }, datum);
            // this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...getMinAdaOfUtxo: ", minAda, typeof (minAda));

            adaAmount = minAda;
        }
        this.logger.debug("..PlutusTxBuilder...", basicArgs.hashX, "...enough token amount: ", adaAmount, tokenId, tokenAmount);

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

    async buildAndSignRawTx(internalSignFunc, basicArgs, tokenAmount, adaAmount, partialRedeemerArgs) {
        const to = basicArgs.crossAddress;
        const tokenId = basicArgs.tokenId;
        const metaData = basicArgs.metaData;
        const uniqueId = basicArgs.hashX;
        const userData = partialRedeemerArgs.userData; // cross Router 
        const addtionalAdaAmount = basicArgs.addtionalAdaAmount; // addtional ada for crossRoute
        this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx current slot: ", this.curChainTip.slot);

        // Step 1: to get treasury data
        let treasuryCheckVH = this.contractService.getTreasuryCheckVH(this.groupInfoToken.datum);
        if (undefined == treasuryCheckVH) {
            throw "failed to get treasury check VH for uniqueId: " + uniqueId;
        }

        // Step 1-1: treasuryCheckRef&&Uxto 
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        if (undefined == checkRefData) {
            throw "empty treasury check ref utxo  for uniqueId: " + uniqueId;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;
        const treasuryScript = this.contractService.getTreasuryScript();

        // Step 1-2: treasury Ref utxo
        let treasuryRef = await this.getScriptRefUtxo(treasuryScript);
        if (undefined === treasuryRef) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo");
            throw "empty treasury ref utxo  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, `...transferValue Treasury ref utxo: ${treasuryRef.txHash + '#' + treasuryRef.index}`);

        // Step 2: to get treasury utxos for ccTask
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...this.lockerScAddress: ", this.lockerScAddress);
        // Step 2-1: to coin select treasury utxos for transfer
        let assetUnit = tokenId;
        let transferAmount = new Array();
        if (Config.AdaTokenId === tokenId) {
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

        let contractUtxoRet = await this.utxosManagerObj.getUtxoOfAmount(this.lockerScAddress,
            to,
            transferAmount,
            this.maxPlutusUtxoNum);
        if (undefined === contractUtxoRet) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo: ");
            throw "failed to get treasury utxos for uniqueId: " + uniqueId;
        }

        let treasuryUtxo = contractUtxoRet.selectedUtxos;
        if (0 === treasuryUtxo.length) {
            // this.logger.debug("\n\n\n..PlutusTxBuilder...", uniqueId, "...mark forced merge status: ", tokenId);
            // to parse pending utxo ratio
            let formatedUtxos = this.commonUtil.formatUtxoData(contractUtxoRet.totalUtxos);

            let totalAssetUtxos = this.commonUtil.filterUtxosByAssetUnit(formatedUtxos, assetUnit);
            // this.logger.debug("..PlutusTxBuilder......getUtxosByUnit:", assetUnit, totalAssetUtxos.length);
            if (0 === totalAssetUtxos.length) {
                this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
                throw "insufficent treasury utxos for transfer for uniqueId: " + uniqueId;
            }

            let pendingUtxoRatio = this.utxosManagerObj.parsePendingUtxoRatio(this.lockerScAddress, totalAssetUtxos);
            if (pendingUtxoRatio >= parseFloat(Config.BalancedCfg.maxPendingUtxoRatio)) {
                this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
                throw "insufficent treasury utxos for transfer for uniqueId: " + uniqueId;
            }

            // to record forced balanced status: the-initial-slot && if-has-been-trigger
            this.mapBalancedDirection.set(assetUnit, Config.BalancedCfg.balancedType_Merge);
            let forcedBalancedStatus = {
                "initialSlot": this.curChainTip.slot
            };
            this.mapForcedBalancedStatus.set(assetUnit, forcedBalancedStatus);
            // to mark forced balanced tag
            await this.markBalancedAsset(this.lockerScAddress, tokenId, this.curLatestBlock.time); //  

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo: ", treasuryCheckUxto);
            throw "insufficent treasury utxos for transfer  for uniqueId: " + uniqueId;
        }

        let bForcedBalancedStatus = false;
        let forcedBalancedStatus = this.mapForcedBalancedStatus.get(assetUnit);
        if (undefined !== forcedBalancedStatus) {
            let duration = this.curChainTip.slot - forcedBalancedStatus.initialSlot;
            bForcedBalancedStatus = (duration >= Config.BalancedCfg.maxForcedBalancedSlot) ? true : false;
        }

        // Step 2-2: combine selectedUtxos with target balanced utxos
        //  this.logger.debug("..PlutusTxBuilder...", uniqueId, "...treasuryUtxo: ", treasuryUtxo);
        let balancedParseRet = {
            "coordinateUtxos": contractUtxoRet.selectedUtxos,
            "outputNum": Config.BalancedCfg.defaultBalancedOutputNum
        };
        if (Config.PlutusCfg.maxUtxoNum >= treasuryUtxo.length) {
            balancedParseRet = this.parseBalancedCoordinate(assetUnit, contractUtxoRet, bForcedBalancedStatus);
            treasuryUtxo = balancedParseRet.coordinateUtxos;
        }

        ////// Step 2-3: to get utxos for fee && collateral
        let treasuryUtxoChangeInfo = this.commonUtil.parseTreasuryUtxoChangeData(
            balancedParseRet,
            transferAmount[0],
            tokenAmount,
            this.protocolParams,
            this.lockerScAddress,
            userData
        );
        if (undefined === treasuryUtxoChangeInfo) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            throw "coin select treasury utxo amount is not enough for transferAmount  for uniqueId: " + uniqueId;
        }
        let txOutputNum = treasuryUtxoChangeInfo.outputNum;
        let marginAda = treasuryUtxoChangeInfo.marginAda;
        adaAmount = treasuryUtxoChangeInfo.adaAmount;

        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str("5000000").checked_add(marginAda);
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
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            to,
            feeValue,
            undefined);
        if (undefined === paymentUtxosRet) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            throw "failed to get leader utxos for fee  for uniqueId: " + uniqueId;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            throw "insufficent leader utxos for fee  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...utxosForFee: ", utxosForFee);

        //TODO：utxosForFee 应该是个数组?--fixed
        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        const nonce = { txHash: treasuryCheckUxto.txHash, index: treasuryCheckUxto.index };
        let assetUint = (Config.AdaTokenId === tokenId) ? "" : tokenId;

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...convertSlotToTimestamp failed: ", err);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee.");

            throw err;
        }

        const redeemerProof = {
            to, tokenId: assetUint, amount: tokenAmount, adaAmount,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '',
            pk: this.groupPK, txType: Config.TaskType.crossTask, uniqueId: uniqueId,
            ttl: ttl2Ts, txTTL: validTTL, outputCount: txOutputNum, userData: userData, additionalAda: addtionalAdaAmount
        };
        this.logger.debug(".....PlutusTxBuilder...", uniqueId, "...redeemerProof: ", JSON.stringify(redeemerProof));


        try {
            const redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, false);
            this.logger.debug(".....PlutusTxBuilder...", uniqueId, "...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
            // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx internalSignFunc: ", signature);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx internalSignFunc exception: ", e);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee.");

            throw e;
        }

        // Step 2: to build transfer value
        let assetAmount = (Config.AdaTokenId === tokenId) ? {} : { [tokenId]: tokenAmount };
        let transferValue = { coins: adaAmount, assets: assetAmount };
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx transferValue: ", transferValue);

        try {
            const signedTxOutBound = await this.contractService.transferFromTreasury(this.protocolParams, utxosForFee,
                treasuryUtxo, treasuryRef, this.groupInfoToken, transferValue, to, redeemerProof, utxosForFee,
                treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this), this.signFn.bind(this), metaData,
                validTTL, txOutputNum);

            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx signedTxOutBound finished. ");
            return signedTxOutBound;

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignRawTx error: ", e);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
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
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx current slot: ", this.curChainTip.slot);

        // Step 1: to get treasury data     
        let mintCheckVH = this.contractService.getTreasuryMintCheckVH(this.groupInfoToken.datum);

        // Step 1-1: treasuryCheckRef&&Uxto 
        let mintCheckRefData = await this.getTreasuryCheckRefAndAvailableUtxo(mintCheckVH, true);
        if (undefined == mintCheckRefData) {
            throw "empty mint check ref or utxo  for uniqueId: " + uniqueId;
        }
        let mintCheckUxto = mintCheckRefData.checkUtxo;
        let mintCheckRef = mintCheckRefData.checkRef;
        const mintScript = this.contractService.getMappingTokenScript();
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...mint check Treasury ref utxo: ", mintCheckUxto, mintCheckRef);

        // Step 1-2: treasury Ref utxo
        let mappingTokenRef = await this.getScriptRefUtxo(mintScript);
        if (undefined === mappingTokenRef) {
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            throw "empty mapping token script ref  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, `...transferValue Treasury ref utxo: ${mappingTokenRef.txHash + '#' + mappingTokenRef.index}`);

        // Step 2: to get leader utxos for mint fee
        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str("5000000");
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
        // this.logger.debug("..PlutusTxBuilder...", uniqueId, "...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            to,
            feeValue,
            undefined);
        if (undefined === paymentUtxosRet) {
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            throw "get leader utxos failed for mint tx fee  for uniqueId: " + uniqueId;
        }

        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            throw "insufficent leader utxos for mint tx fee  for uniqueId: " + uniqueId;
        }

        let collateralUtxos = undefined; // len is no more than 3, sort by ada & fetch the 3 largest item

        if (Config.PlutusCfg.maxCollacteralUtxosNum < utxosForFee.length) {
            utxosForFee.sort(this.commonUtil.compareUtxoAssetValue("lovelace").bind(this));
            collateralUtxos = new Array();
            for (let i = 0; i < Config.PlutusCfg.maxCollacteralUtxosNum; i++) {
                let utxoIndex = utxosForFee.length - i - 1;
                collateralUtxos.push(utxosForFee[utxoIndex]);
            }
        } else {
            collateralUtxos = utxosForFee;
        }
        //this.logger.debug("..PlutusTxBuilder...", uniqueId, "...utxos For Fee & Collateral: ", utxosForFee, collateralUtxos);

        //TODO：utxosForFee 应该是个数组?--fixed
        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        const nonce = { txHash: mintCheckUxto.txHash, index: mintCheckUxto.index };
        let assetUint = (Config.AdaTokenId === tokenId) ? "" : tokenId;

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx convertSlotToTimestamp exception: ", err);

            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
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
            const redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, true);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx internalSignFunc exception: ", e);
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw e;
        }

        // Step 4: to build mint value
        try {
            const signedTxOutBound = await this.contractService.mint(this.protocolParams, utxosForFee, collateralUtxos,
                mappingTokenRef, mintCheckRef, this.groupInfoToken, mintCheckUxto, redeemerProof, this.paymentAddress,
                this.evaluateFn.bind(this), this.signFn.bind(this), validTTL, metaData);

            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx...signedTxOutBound finished. ");
            return signedTxOutBound;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...buildAndSignMintRawTx error: ", e);
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw e;
        }
    }

    ////////////////////////////////////////////
    //// PART 4: Utxo Balanced Processing Funs
    ////////////////////////////////////////////
    async markBalancedAsset(scAddress, assetUnit, curBlockSlot) {
        if (undefined === this.mapScBalancedMarkRecord) {
            this.mapScBalancedMarkRecord = new Map();
        }

        if (undefined === curBlockSlot) {
            if (undefined === this.curLatestBlock) {
                await this.getCurChainParams();
            }
            curBlockSlot = this.curLatestBlock.time;
        }

        // to convert asset unit to format unit
        if (Config.AdaTokenId === assetUnit) {
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

        } else if (assetMarkRecord.markSlot < curBlockSlot) {
            assetMarkRecord.markSlot = curBlockSlot;
            scMarkRecord.set(assetUnit, assetMarkRecord);
            console.log("...markBalancedAsset...", assetUnit, assetMarkRecord);
            this.mapScBalancedMarkRecord.set(scAddress, scMarkRecord);
        }
    }

    parseBalancedCoordinate(assetUnit, treasuryUtxoRet, bForcedBalancedStatus) {
        if (undefined === treasuryUtxoRet) {
            return undefined;
        }

        let totalUtxos = treasuryUtxoRet.totalUtxos;
        let coordinateUtxos = treasuryUtxoRet.selectedUtxos;
        let ret = {
            "coordinateUtxos": coordinateUtxos,
            "outputNum": Config.BalancedCfg.defaultBalancedOutputNum
        }

        let availableUtxos = this.utxosManagerObj.checkAvailableUtxos(this.lockerScAddress, totalUtxos, false, assetUnit);
        if (undefined === availableUtxos) {
            // to set asset balanced direction to split
            let splitRet = this.utxoSplitService.confirmUtxoSplitCondition(assetUnit, totalUtxos, coordinateUtxos);
            if (undefined !== splitRet) {
                // in case split conditon is satisfied, return split result
                return splitRet;
            }
            // in case confirmRet is undefined, then just return default ret
            return ret;
        }

        let balancedOption = this.commonUtil.getPendingBalancedUtxosByUnit(availableUtxos, assetUnit);
        if (undefined === balancedOption) {
            return ret;
        }

        console.log("\n\n this.curBalancedParams ", this.curBalancedParams);
        if (undefined === this.mapBalancedDirection.get(assetUnit)) {
            // if there is no balanced process for this assetUnit, then to check if need to trigger in this tasks
            if (balancedOption.assetUtxos.length > this.curBalancedParams.balancedCfg.utxoNumThresheld.maxUtxoListLen) {
                this.mapBalancedDirection.set(assetUnit, Config.BalancedCfg.balancedType_Merge);
                console.log("\n\n balanced direction: balancedType_Merge ", Config.BalancedCfg.balancedType_Merge);

            } else if (balancedOption.assetUtxos.length < this.curBalancedParams.balancedCfg.utxoNumThresheld.minUtxoListLen) {
                if (bForcedBalancedStatus) {
                    return ret;
                }
                this.mapBalancedDirection.set(assetUnit, Config.BalancedCfg.balancedType_Split);
                console.log("\n\n balanced direction: balancedType_Split ", Config.BalancedCfg.balancedType_Split);

            } else {
                console.log("\n\n balanced direction: no need to balanced ");
                return ret;
            }
        }

        let marginUtxoNum = Config.PlutusCfg.maxUtxoNum - coordinateUtxos.length;
        console.log("\n\n balanced marginUtxoNum:", coordinateUtxos.length, marginUtxoNum);

        let balancedMode = undefined;
        let balancedDirection = this.mapBalancedDirection.get(assetUnit);
        if (Config.BalancedCfg.balancedType_Merge === balancedDirection) {
            if (bForcedBalancedStatus) {
                balancedMode = Config.BalancedCfg.mergePolicy_Desc;
            } else if ((balancedOption.assetUtxos.length - marginUtxoNum) < this.curBalancedParams.balancedCfg.utxoNumThresheld.idealUtxoListLen) {
                this.mapBalancedDirection.set(assetUnit, undefined);
                return ret;
            } else {
                balancedMode = Config.BalancedCfg.mergePolicy_Asc;
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

        if (Config.BalancedCfg.balancedType_Split === balancedDirection) {
            let splitRet = this.utxoSplitService.confirmUtxoSplitCondition(assetUnit, totalUtxos, coordinateUtxos);
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

    // to filter input-existed utxos from balanced utxos list
    getTargetBalancedUtxos(balancedOption, mode, existInputUtxos = []) {
        if (undefined === balancedOption) {
            return;
        }

        let formatExistUtxos = this.commonUtil.formatUtxoData(existInputUtxos);
        // to sort balanced utxos
        console.log("\n\n...getTargetBalancedUtxos balancedOption.assetUtxos: ", balancedOption.assetUnit, balancedOption.assetUtxos);
        balancedOption.assetUtxos.sort(this.commonUtil.compareUtxoAssetValue(balancedOption.assetUnit).bind(this));

        let utxosLen = balancedOption.assetUtxos.length;
        let outputNum = 1;
        let targetUtxos = new Array();

        let mapConsumedUtxos = this.utxosManagerObj.getPendingComsumedUtxoByAddress(this.lockerScAddress);
        if (undefined === mapConsumedUtxos) {
            mapConsumedUtxos = new Map();
        }

        // to fetch target utxos to build balanced tx
        console.log("\n\n...getTargetBalancedUtxos mapBalancedDirection: ", this.mapBalancedDirection.get(balancedOption.assetUnit));
        if (Config.BalancedCfg.balancedType_Merge === this.mapBalancedDirection.get(balancedOption.assetUnit)) {
            // to get target utxos that need to merge            
            let selectedNum = 0;
            for (let i = 0; i < balancedOption.assetUtxos.length; i++) {
                if (selectedNum === (Config.PlutusCfg.maxUtxoNum - existInputUtxos.length)) { // 
                    console.log("\n\n finish to select the right utxo to balanced");
                    break;
                }

                // Config.PlutusCfg.maxUtxoNum
                let itemNo = i; // default policy: from min to max value
                if (Config.BalancedCfg.mergePolicy_Desc === mode) {
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
                    this.utxosManagerObj.appendPendingComsumedUtxo(this.lockerScAddress,
                        tmpBalancedUtxo,
                        this.curChainTip.slot);
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
                    this.utxosManagerObj.appendPendingComsumedUtxo(this.lockerScAddress,
                        tmpBalancedUtxo,
                        this.curChainTip.slot);

                    break;
                }
            }
            // to confirm splited output num
            if (0 === targetUtxos.length) {
                outputNum = Config.BalancedCfg.minSpitedUtxoNum;
            } else {
                outputNum = Config.BalancedCfg.minSpitedUtxoNum + 1;
            }
        }

        let ret = {
            "targetUtxos": targetUtxos,
            "outputNum": outputNum
        }

        return ret;
    }

    async fetchBalancedParams() {
        // step 2: to get lock 
        if ((undefined !== this.curBalancedParams)
            && ((this.curBalancedParams.activeSlot + Config.BalancedCfg.configValidLatestSlot) >= this.curChainTip.slot)) {
            return true;
        }

        while (this.mapAccountLocker.get("balancedCfgLocker")) {
            await this.commonUtil.sleep(1000);
        }
        this.mapAccountLocker.set("balancedCfgLocker", true);

        if ((undefined === this.curBalancedParams)
            || ((this.curBalancedParams.activeSlot + Config.BalancedCfg.configValidLatestSlot) < this.curChainTip.slot)) {
            try {
                let ret = await this.connector.getBalancedConfig();
                this.logger.debug("..PlutusTxBuilder......getBalancedConfig ret: ", ret);
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

        // Step 1: to get the latest net params
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
                return undefined; //Config.ErrorDef.ErrorCode_NetworkException;
            }

            this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
            this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...groupInfoFromDatum...groupPK: ", this.groupPK);

            if (this.groupPK !== encodedGpk) {
                this.logger.debug("..PlutusTxBuilder...tryUtxosBalanced...getScriptRefUtxo...warning: inconsistent gpk");
                return undefined;
            }
        }

        // Step 3: to build & sign & submit balanced tx        
        if (undefined === this.mapScBalancedMarkRecord) {
            this.mapScBalancedMarkRecord = new Map();
        }
        let mapScMarkRecord = this.mapScBalancedMarkRecord.get(scAddress);
        if (undefined === mapScMarkRecord) {
            this.logger.debug("\n\n...tryUtxosBalanced...there is no mark record for this round!");
            return undefined;
        }

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
                continue;

            } else {
                // to set asset merge flag && merge slot
                assetMarkRecord.mergeFlag = true;
                assetMarkRecord.mergeSlot = assetMarkRecord.markSlot;
                mapScMarkRecord.set(assetUnit, assetMarkRecord);
            }

            this.logger.debug("..PlutusTxBuilder......buildBalancedTx......assetUnit:", assetUnit);

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
        let mode = Config.BalancedCfg.mergePolicy_Asc;

        // Step 1: to get utxo with valid datum   
        let utxos = await this.utxosManagerObj.getUtxo(scAddress); // null-datum utxos have been filtered
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

        let pendingUtxoRatio = this.utxosManagerObj.parsePendingUtxoRatio(scAddress, totalAssetUtxos);
        this.logger.debug("..tryAssetUtxosBalanced...pendingUtxoRatio:", assetUnit, pendingUtxoRatio);
        if (pendingUtxoRatio >= parseFloat(Config.BalancedCfg.maxPendingUtxoRatio)) {
            return true;
        }

        // Step 3: to get available utxos, pendingConsumed/multi-asset utxos will be filtered
        let availableUtxos = this.utxosManagerObj.checkAvailableUtxos(scAddress, utxos, false, assetUnit); // 
        if (undefined === availableUtxos) {
            this.logger.debug("\n\n...tryAssetUtxosBalanced...there is no available utxos for treasury sc!");
            return true;
        }
        this.logger.debug("\n\n...tryAssetUtxosBalanced...checkAvailableUtxos: ", scAddress, availableUtxos.length);

        // Step 3-1: to get pending balanced utxos of asset
        let balancedOption = this.commonUtil.getPendingBalancedUtxosByUnit(availableUtxos, assetUnit);
        if (undefined === balancedOption) {
            // there is no available asset unit matched utxos
            return true;
        }
        // console.log("..PlutusTxBuilder...buildBalancedTx...balancedOption: ", assetUnit, balancedOption);

        // Step 3-2: to check mode
        let bForcedBalancedStatus = false;
        let forcedBalancedStatus = this.mapForcedBalancedStatus.get(assetUnit);
        if (undefined != forcedBalancedStatus) {

            let forceBalancedEndSlot = forcedBalancedStatus.initialSlot + Config.BalancedCfg.maxForcedBalancedSlot;
            console.log("\n\n...mapForcedBalancedStatus...should to merge by forced: ", assetUnit, forcedBalancedStatus, forceBalancedEndSlot);
            let latestMergedSlot = this.mapAssetBalancedTs.get(assetUnit);
            latestMergedSlot = (undefined === latestMergedSlot) ? 0 : latestMergedSlot;

            if ((this.curChainTip.slot <= forceBalancedEndSlot) && (latestMergedSlot <= forcedBalancedStatus.initialSlot)) {
                mode = Config.BalancedCfg.mergePolicy_Desc;
                this.mapBalancedDirection.set(assetUnit, Config.BalancedCfg.balancedType_Merge);
                console.log("\n\n...getTargetBalancedUtxos mapBalancedDirection: ", this.mapBalancedDirection.get(assetUnit));

                bForcedBalancedStatus = true;
            }
        }

        // 2023/06/27 modify: balancedParam N1/2/3 related to available utxos number
        if (!bForcedBalancedStatus) {
            console.log("\n\n...mapBalancedDirection: ", assetUnit, balancedOption.assetUtxos);
            if (undefined === this.mapBalancedDirection.get(assetUnit)) {
                if (balancedOption.assetUtxos.length >= this.curBalancedParams.balancedCfg.utxoNumThresheld.maxUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, Config.BalancedCfg.balancedType_Merge);
                    console.log("\n\n...set BalancedDirection to merge: ", assetUnit, this.mapBalancedDirection.get(assetUnit));

                } else if (balancedOption.assetUtxos.length <= this.curBalancedParams.balancedCfg.utxoNumThresheld.minUtxoListLen) {
                    this.mapBalancedDirection.set(assetUnit, Config.BalancedCfg.balancedType_Split);
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
            if (Config.BalancedCfg.balancedType_Merge === balancedDirection) {
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
        if (Config.BalancedCfg.balancedType_Split === this.mapBalancedDirection.get(assetUnit)) {
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
            this.utxosManagerObj.deletePendingComsumedUtxoById(this.lockerScAddress, utxoId);

            return true;
        }
        this.logger.debug("\n\n..tryAssetUtxosBalanced...getTargetBalancedUtxos rslt: ", rslt);

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
        let treasuryCheckVH = this.contractService.getTreasuryCheckVH(this.groupInfoToken.datum);
        if (undefined == treasuryCheckVH) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getTreasuryCheckRefAndAvailableUtxo...warning: EmptyCheckUtxo");
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            return undefined;
        }

        // Step 1-1: to get treasury check ref and utxo
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        if (undefined == checkRefData) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getTreasuryCheckRefAndAvailableUtxo...warning: EmptyCheckUtxo");
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            return undefined;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;
        const treasuryScript = this.contractService.getTreasuryScript();

        // Step 1-2: to get treasury ref and utxo
        let treasuryRef = await this.getScriptRefUtxo(treasuryScript);
        if (undefined === treasuryRef) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getScriptRefUtxo...warning:.EmptyScriptRefUtxo");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            return undefined;
        }
        // this.logger.debug(`..PlutusTxBuilder...buildBalancedTx...transferValue Treasury ref utxo: ${treasuryRef.txHash + '#' + treasuryRef.index}`);

        // Step 1-4: to caculate the total assert value of targetUtxos
        let balancedValue = this.commonUtil.caculateInputValue(targetUtxos);
        if (CardanoWasm.BigNum.from_str('0') === balancedValue.coin) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getScriptRefUtxo...warning: insufficent utxos");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            return undefined;
        }
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...balancedValue: ", balancedValue);

        // Step 2: to caculate the max fee for balanced tx, on leader account.
        let feeValue = new Array();
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": 2000000
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            this.lockerScAddress,
            feeValue,
            undefined);
        if (undefined === paymentUtxosRet) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getUtxoOfAmount...warning: get UtxoForFee failed");
            return undefined;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx...getUtxoOfAmount...warning: inSufficent Utxo For Fee");
            return undefined;
        }
        // this.logger.debug("..PlutusTxBuilder...buildBalancedTx...utxosForFee: ", utxosForFee);

        // Step 3: add tx input based on utxo data  
        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            return undefined;
        }
        // this.logger.debug("..PlutusTxBuilder......buildBalancedTx...validTTL: ", validTTL);

        const nonce = { txHash: treasuryCheckUxto.txHash, index: treasuryCheckUxto.index };
        const tokenAmount = "0"; //("lovelace" === assetUnit) ? 0 : balancedValue.asset.get(assetUnit.replace(".", "")).to_str();
        const tokenId = ("lovelace" === assetUnit) ? "" : assetUnit;
        // this.logger.debug("..PlutusTxBuilder......buildBalancedTx...tokenAmount: ", assetUnit, tokenAmount);
        const adaAmount = "0"; //balancedValue.coin.to_str();
        const userData = this.commonUtil.genDemoDatum42().to_hex();
        const redeemerProof = {
            to: this.lockerScAddress, tokenId: tokenId, amount: tokenAmount, adaAmount,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '', pk: this.groupPK,
            txType: Config.TaskType.balancedTask, uniqueId: "", ttl: ttl2Ts, txTTL: validTTL,
            userData: userData, outputCount: outputNum
        };
        this.logger.debug(".....PlutusTxBuilder...buildBalancedTx...redeemerProof: ", JSON.stringify(redeemerProof));

        try {
            let tmpPartialRedeemerArgs = {
                "hashKey": "",
                "crossTokenAddr": ("lovelace" === assetUnit) ? Config.AdaTokenId : assetUnit,
                "amount": ("lovelace" === assetUnit) ? adaAmount : tokenAmount,
                "fee": 0,
                "crossAddressHex": this.lockerScAddress
            };

            // add mpc inner sign
            const redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, false);
            this.logger.debug(".....PlutusTxBuilder...buildBalancedTx...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(tmpPartialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx internalSignFunc exception: ", e);
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx release availableTargetUtxos.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildBalancedTx release treasuryCheckUxto.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
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
            const signedTxOutBound = await this.contractService.transferFromTreasury(this.protocolParams, utxosForFee,
                availableTargetUtxos, treasuryRef, this.groupInfoToken, transferValue, this.lockerScAddress, redeemerProof,
                utxosForFee, treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this),
                this.signFn.bind(this), metaData, validTTL, outputNum);

            return signedTxOutBound;

        } catch (e) {
            this.logger.error("..PlutusTxBuilder......transferFromTreasury...e: ", e);
            this.utxosManagerObj.releaseUtxos(availableTargetUtxos);
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            return undefined; //throw e;
        }
    }

    /////////////////////////////////////////////////
    //// PART 5: build extra binded-ADA tx raw data
    /////////////////////////////////////////////////
    parseExtraBindAdaUtxos(totalUtxos, availableUtxos, assetUnit) {
        // to fetch the bind-ada strip Config params
        const bindAdaStripCfg = this.curBalancedParams.balancedCfg.bindAdaStripCfg;
        const bnStrippedTreshold = CardanoWasm.BigNum.from_str(bindAdaStripCfg.strippedAdaThreshold); //30 ada
        const bnReservedValue = CardanoWasm.BigNum.from_str(bindAdaStripCfg.reservedAdaThreshold); //5 ada

        // to fetch utxo which should be stripped 
        let extrableUtxo = this.adaExtraService.parseExtraBindAdaUtxos(bnStrippedTreshold, availableUtxos, assetUnit);

        // to build strip record in case stripped utxo has been matched
        if (undefined !== extrableUtxo) {
            // to mark pending Consumed status
            let txId = extrableUtxo.txIn.txId;
            let txIndex = extrableUtxo.txIn.index;

            for (let k = 0; k < totalUtxos.length; k++) {
                let utxo = totalUtxos[k];

                if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                    // to add new pending consumed utxos
                    this.utxosManagerObj.appendPendingComsumedUtxo(this.lockerScAddress,
                        extrableUtxo,
                        this.curChainTip.slot);

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

        return undefined;
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
        let treasuryCheckVH = this.contractService.getTreasuryCheckVH(this.groupInfoToken.datum);
        if (undefined == treasuryCheckVH) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            return undefined;//throw "empty treasury check ref utxo  for uniqueId: " + uniqueId;
        }

        // Step 1-1: treasuryCheckRef&&Uxto 
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        if (undefined == checkRefData) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            return undefined;//throw "empty treasury check ref utxo  for uniqueId: " + uniqueId;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;
        const treasuryScript = this.contractService.getTreasuryScript();

        // Step 1-2: treasury Ref utxo
        let treasuryRef = await this.getScriptRefUtxo(treasuryScript);
        if (undefined === treasuryRef) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
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
        let feeAmount = CardanoWasm.BigNum.from_str("5000000");
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            to,
            feeValue,
            undefined);
        if ((undefined === paymentUtxosRet) || (0 === paymentUtxosRet.selectedUtxos.length)) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");

            return undefined; //throw "failed to get leader utxos for fee  for uniqueId: " + uniqueId;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...utxosForFee: ", utxosForFee);

        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        const nonce = { txHash: treasuryCheckUxto.txHash, index: treasuryCheckUxto.index };

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...convertSlotToTimestamp failed: ", err);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release utxosForFee.");

            return undefined;
        }

        const userData = this.commonUtil.genDemoDatum42().to_hex();
        const redeemerProof = {
            to, tokenId: tokenId, amount: 0, adaAmount,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '',
            pk: this.groupPK, txType: Config.TaskType.crossTask, uniqueId: uniqueId,
            ttl: ttl2Ts, txTTL: validTTL, userData: userData, outputCount: txOutputNum
        };
        this.logger.debug(".....PlutusTxBuilder...buildAndSignAdaStripTx...redeemerProof: ", JSON.stringify(redeemerProof));


        try {
            let tmpPartialRedeemerArgs = {
                "hashKey": "",
                "crossTokenAddr": Config.AdaTokenId,
                "amount": adaAmount,
                "fee": 0,
                "crossAddressHex": bindAdaStripCfg.foundationAddress
            };

            const redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, false);
            this.logger.debug(".....PlutusTxBuilder...buildAndSignAdaStripTx...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(tmpPartialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
            // this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx internalSignFunc: ", signature);
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx internalSignFunc exception: ", e);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release utxosForFee.");

            return undefined;
        }

        // Step 2: to build stripped ada value
        let transferValue = { coins: adaAmount, assets: {} };
        try {
            const signedTxOutBound = await this.contractService.transferFromTreasury(this.protocolParams, utxosForFee,
                treasuryUtxo, treasuryRef, this.groupInfoToken, transferValue, to, redeemerProof, utxosForFee,
                treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this), this.signFn.bind(this),
                metaData, validTTL, txOutputNum);

            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx signedTxOutBound finished. ");
            return signedTxOutBound;

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...buildAndSignRawTx error: ", e);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusTxBuilder...buildAndSignAdaStripTx...release utxosForFee.");

            return undefined;
        }
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

    ///////////////////////////////////
    //// PART 6: tx related functions
    ///////////////////////////////////
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


}


module.exports = PlutusTxBuilder;
