const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const Common = require('./util/common');
const Config = require('./config');
const Cbor = require('cbor-sync');
const UtxoSelectionService = require('./bizServices/utxoSelectionService');
const NftContractService = require('./bizServices/nftContractService');
const BalanceTxMultiSig = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const LEADER_FEE_AMOUNT = "5000000";

class PlutusNftTxBuilder {

    constructor(chainConnector, scriptRefOwnerAddr, utxosManager, logUtil, bMainnet) {
        this.connector = chainConnector;
        this.scriptRefOwnerAddr = scriptRefOwnerAddr;
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
        this.mapAccountLocker = new Map();

        // supportted token 
        this.mapValidAssetType = new Map();

        // to new common util instance
        this.commonUtil = new Common(this.ADDR_PREFIX);
        this.utxoSelectionService = new UtxoSelectionService(this.ADDR_PREFIX);
        this.contractService = new NftContractService(bMainnet, this.ADDR_PREFIX, logUtil);

        this.validCheckTokenPolicyId = this.contractService.validCheckTokenPolicyId;
        this.validMappingCheckTokenPolicyId = this.contractService.validMappingCheckTokenPolicyId;

        this.logger = logUtil;
        this.memScriptRefUtxos = new Array();
    }

    init() {
        // let stakeCred = await this.getGroupInfoStkVh();
        this.nftRefHolderAddr = this.getNFTRefHolderScript();
        if (undefined === this.nftRefHolderAddr) {
            return false;
        }

        this.lockerScAddress = this.bMainnet ? Config.MainNet.NftTreasuryScAddress: Config.TestNet.NftTreasuryScAddress;
        console.log("\n\n..init...the nft lockerScAddress: ", this.lockerScAddress);
        if (undefined === this.lockerScAddress) {
            return false;
        }

        this.signMode = this.contractService.getSignMode();
        this.validPolicyId = this.contractService.getValidPolicyId();

        this.utxosManagerObj.setNftTreasuryScAddress(this.lockerScAddress);
        console.log("\n\n\n\******* this.lockerScAddress: ", this.lockerScAddress);

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
    async checkNFTRefAssets(refAssetHolder, refAssets) {

        let mapAssetAvailable = new Map();
        for (let j = 0; j < refAssets.length; j++) {
            let assetUnit = refAssets[j];
            mapAssetAvailable.set(assetUnit, false);
        }

        let utxos = await this.utxosManagerObj.getUtxo(refAssetHolder, false);
        for (let i = 0; i < utxos.length; i++) {
            /*
            {
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
            }            
            */
            let itemAssets = utxos[i].value.assets;
            for (let assetUnit of itemAssets.keys()) {
                let index = refAssets.indexOf(assetUnit);
                if (-1 !== index) {
                    mapAssetAvailable.set(assetUnit, true);
                }
            }
            for (let assetUnit in itemAssets) {
                let index = refAssets.indexOf(assetUnit);
                if (-1 !== index) {
                    mapAssetAvailable.set(assetUnit, true);
                }
            }
        }

        return mapAssetAvailable;
    }

    convertMetadata2TxDatum(metaData) {
        let txDatum = this.commonUtil.metadata2datum(metaData);
        return txDatum;
    }

    genNFTAssetName(name, typeCode) {
        let nftAssetName = this.contractService.genNFTAssetName(name, typeCode);
        return nftAssetName;
    }

    genNFTIdFromAssetName(assetNameHex) {
        let nftId = this.contractService.genNFTIdFromAssetName(assetNameHex);
        return nftId;
    }

    getNFTRefHolderScript() {
        // need to check whether this hold address is given by sc sdk?? or transfer by agent??
        let nftRefHolderAddr = this.contractService.getRefHolderScript().to_bech32();
        return nftRefHolderAddr;
    }

    async genRedeemProofHash(proofInfo) {
        try {
            if (undefined === this.groupInfoToken) {
                this.groupInfoToken = await this.getGroupInfoToken();
                // this.logger.debug("..PlutusNftTxBuilder......genRedeemProofHash()... init groupInfoToken: ", this.groupInfoToken);
                if (false === this.groupInfoToken) {
                    throw "network exception";
                }

                this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
            }

            let redeemerProof = {
                to: proofInfo.to,
                crossValue: proofInfo.crossValue,
                txHash: proofInfo.txHash,
                index: proofInfo.index,
                mode: this.signMode,
                signature: '',
                // pk: this.groupPK,
                uniqueId: proofInfo.uniqueId,
                policy_id: proofInfo.policy_id,
                txType: proofInfo.txType,
                ttl: proofInfo.ttl
            }
            this.logger.debug("..PlutusNftTxBuilder......genRedeemProofHash redeemerProof: ", JSON.stringify(redeemerProof, null, 0))
            let redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, false);
            this.logger.debug("..PlutusNftTxBuilder......genRedeemProofHash caculateRedeemDataHash: ", redeemProofHash);

            return redeemProofHash;
        } catch (e) {
            this.logger.error("..PlutusNftTxBuilder...genRedeemProofHash...catch error : ", e);
            throw e;
        }
    }

    async genTokenRedeemProofHash(proofInfo) {
        try {
            if (undefined === this.groupInfoToken) {
                this.groupInfoToken = await this.getGroupInfoToken();
                // this.logger.debug("..PlutusNftTxBuilder......genRedeemProofHash()... init groupInfoToken: ", this.groupInfoToken);
                if (false === this.groupInfoToken) {
                    throw "network exception";
                }

                this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
            }

            let redeemerProof = {
                to: proofInfo.to,
                // crossValue: proofInfo.crossValue,
                txHash: proofInfo.txHash,
                index: proofInfo.index,
                mode: this.signMode,
                signature: '',
                // pk: this.groupPK,
                uniqueId: proofInfo.uniqueId,
                policy_id: proofInfo.policy_id,
                nftAssets: proofInfo.nftAssets,
                nftRefAssets: proofInfo.nftRefAssets,
                userData: proofInfo.userData,
                ttl: proofInfo.ttl
            }
            // this.logger.debug("..PlutusNftTxBuilder......genRedeemProofHash redeemerProof: ", JSON.stringify(redeemerProof, null, 0))
            let redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, true);
            this.logger.debug("..PlutusNftTxBuilder......genTokenRedeemProofHash caculateRedeemDataHash: ", redeemProofHash);

            return redeemProofHash;
        } catch (e) {
            this.logger.error("..PlutusNftTxBuilder...genTokenRedeemProofHash...catch error : ", e);
            throw e;
        }
    }

    async deCodeTxRedeemersCbor(txInfo, bMintCheck) {
        // this.logger.debug("..PlutusNftTxBuilder...", txInfo.hash, "...deCodeTxRedeemersCbor txInfo: ", txInfo);

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txInfo.hash);
            // this.logger.debug("..PlutusNftTxBuilder...deCodeTxRedeemersCbor...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder...deCodeTxRedeemersCbor...get txsUtxos...error: ", e);
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
        // console.log("\n..getTreasuryCheckRefAndAvailableUtxo treasuryCheckRef: ", treasuryCheckRef.length);
        if (undefined === treasuryCheckRef) {
            this.logger.debug("..PlutusNftTxBuilder...getScriptRefUtxoByVH...error:: no available check ref utxo");
            return undefined;
        }

        // Step 2: treasuryCheckUxto  : to monitor this script check utxos
        let scriptCheckRefAddress = await this.getTreasuryCheckAddress(bMintCheck);
        console.log("\n..getTreasuryCheckRefAndAvailableUtxo scriptCheckRefAddress: ", scriptCheckRefAddress);
        let treasuryCheckUxto = await this.getScriptCheckRefAvailableUtxo(scriptCheckRefAddress);
        console.log("\n..getTreasuryCheckRefAndAvailableUtxo treasuryCheckUxto: ", treasuryCheckUxto);
        if (undefined === treasuryCheckUxto) {
            this.logger.debug("..PlutusNftTxBuilder...getScriptCheckRefAvailableUtxo...warning:: no available check utxo");
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
            // this.logger.debug(`..PlutusNftTxBuilder...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
            let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoItem.txId, 'hex'));
            let txInput = CardanoWasm.TransactionInput.new(transaction_id, utxoItem.index);

            // to generate utxoId by txInput
            let utxoId = txInput.to_hex();
            // this.logger.debug(`..PlutusNftTxBuilder..getTreasuryCheckUtxosTotalNum...to match Key: ${utxoId}`);

            let mapConsumedUtxos = this.utxosManagerObj.getPendingComsumedUtxoByAddress(scriptCheckRefAddress);
            if (mapConsumedUtxos.get(utxoId)) {
                // this.logger.debug(`..PlutusNftTxBuilder..release utxoId: #${utxoId} in pendingUtxo of address: ${address}`);
                continue;
            };

            availableCheckUtxoCount++;
        }

        this.logger.debug("..PlutusNftTxBuilder...availalbe check utxos num: ", bMintCheck, scriptCheckRefAddress, availableCheckUtxoCount);
        return availableCheckUtxoCount;
    }

    async getScriptCheckRefAvailableUtxo(scriptCheckRefAddress) {

        let utxos = await this.utxosManagerObj.getUtxo(scriptCheckRefAddress, false);
        this.logger.debug("..PlutusNftTxBuilder......get scriptCheckRef utxos: ", scriptCheckRefAddress, utxos.length);
        if (0 === utxos.length) {
            this.logger.debug("..PlutusNftTxBuilder.....warning: get no scriptCheckRef utxos.");
            return undefined;
        }

        let availableUtxos = this.utxosManagerObj.checkAvailableUtxos(scriptCheckRefAddress, utxos, true);
        // this.logger.debug("..PlutusNftTxBuilder......availableUtxos: ", availableUtxos);
        if ((undefined === availableUtxos) || (availableUtxos.length < 1)) {
            this.logger.debug("..PlutusNftTxBuilder...getScriptCheckRefAvailableUtxo...warning: no available check utxo");
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
                // this.logger.debug("..PlutusNftTxBuilder......selected validCheckTokenUtxos: ", utxo);
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

    fetchRefUtxoFromMem(keyHash) {
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
            return scriptHash == keyHash
        });

        return ref;
    }

    async getScriptRefUtxoByVH(checkVH) {
        // console.log(`..PlutusNftTxBuilder....getScriptRefUtxoByVH ${refUtxo.length} utxos of scriptRefOwner: ${this.scriptRefOwnerAddr} `);

        let ref = this.fetchRefUtxoFromMem(checkVH);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.fetchRefUtxoFromMem(checkVH);
        }
        // this.logger.debug(`..PlutusNftTxBuilder.... getScriptRefUtxoByVH's ref-utxo: ${JSON.stringify(ref)} `);
        return ref;
    }

    async getScriptRefUtxo4MappingToken(mappingTokenPolicyId) {

        let ref = this.fetchRefUtxoFromMem(checkVH);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.fetchRefUtxoFromMem(mappingTokenPolicyId);
        }
        // this.logger.debug(`..PlutusNftTxBuilder.... getScriptRefUtxoByVH's ref-utxo: ${JSON.stringify(ref)} `);
        return ref;
    }

    async getScriptRefUtxo(script) {
        // this.logger.debug(`..PlutusNftTxBuilder....get ${refUtxo.length} utxos of scriptRefOwner: ${this.scriptRefOwnerAddr} `);

        let ref = this.memScriptRefUtxos.find(o => script.to_hex().indexOf(o.script['plutus:v2'] || o.script['plutus:v3']) >= 0);
        if (undefined === ref) {
            // refresh scriptRefUtxos from wanOgmiosService
            this.memScriptRefUtxos = await this.getUtxo(this.scriptRefOwnerAddr, false);
            ref = this.memScriptRefUtxos.find(o => script.to_hex().indexOf(o.script['plutus:v2'] || o.script['plutus:v3']) >= 0);
        }
        // this.logger.debug(`..PlutusNftTxBuilder.... scriptRefOwner's ref-utxo: ${JSON.stringify(ref)} `);
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

        console.log("..getGroupInfoToken: ", groupInfo);

        const groupInfoToken = (await this.utxosManagerObj.getUtxo(groupInfoHolder)).find(o => {
            console.log("utxosManager get utxo ret: ", groupInfoHolder, o);
            for (let tokenId in o.value.assets) {
                tokenId = tokenId.replace(".", "");
                console.log("utxosManager tokenId: ", tokenId);
                if (tokenId == expectedTokenId) return true;
            }
            return false;
        });
        //this.logger.debug("..PlutusNftTxBuilder......groupInfoToken ", groupInfoToken);
        if (undefined === groupInfoToken) {
            return false;
        }
        console.log("..getGroupInfoToken groupInfoToken: ", groupInfoToken);
        return groupInfoToken;
    }

    async getGroupInfoStkVh() {
        this.groupInfoToken = await this.getGroupInfoToken();
        //this.logger.debug("..PlutusNftTxBuilder......getGroupInfoToken...: ", this.groupInfoToken);
        console.log("..groupInfoToken: ", this.groupInfoToken);
        if (false === this.groupInfoToken) {
            throw "getGroupInfoStkVh: exception network during get group info token";
        }

        let StkVh = this.contractService.getGroupInfoStkVh(this.groupInfoToken.datum);
        //this.logger.debug("..PlutusNftTxBuilder......groupInfoFromDatum...StkVh: ", StkVh);
        console.log("..getGroupInfoToken StkVh: ", StkVh);
        return StkVh;
    }

    async getTreasuryCheckAddress(bMintCheck) {
        this.groupInfoToken = await this.getGroupInfoToken();
        this.logger.debug("..PlutusNftTxBuilder......getGroupInfoToken...: ", this.groupInfoToken);
        if (false === this.groupInfoToken) {
            throw "getTreasuryCheckAddress: exception network during get group info token";
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
            // this.logger.debug("..PlutusNftTxBuilder......latestChainTip: ", latestChainTip);
        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder......failed to get chainTip: ", e);
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
                // this.logger.debug("..PlutusNftTxBuilder......this.curLatestBlock: ", this.curLatestBlock);
            } catch (e) {
                this.logger.debug("..PlutusNftTxBuilder......get blocksLatest failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                let tmpProtocolParams = await this.connector.getCurrentProtocolParameters();
                // this.logger.debug("..PlutusNftTxBuilder......protocolParams: ", this.protocolParams);
                if ((undefined === tmpProtocolParams) || ("" === tmpProtocolParams)) {
                    this.logger.debug("..PlutusNftTxBuilder......getCurChainParams failed: ");
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
                this.logger.debug("..PlutusNftTxBuilder......getCurChainParams failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                this.curChainTip = await this.connector.chainTip();
                this.logger.debug("..PlutusNftTxBuilder......get this.curChainTip onchain: ", this.curChainTip);

            } catch (e) {
                this.logger.debug("..PlutusNftTxBuilder......get chainTip failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

        }

        this.mapAccountLocker.set("latestChainStatusLocker", false);
        return true;
    }

    async confirmTx(txHash) {
        if (undefined === this.lockerScAddress) {
            let ret = await this.init();
            if (false === ret) {
                throw "failed to initial sdk!";
            }
        }
        // this.logger.debug("..PlutusNftTxBuilder...", txHash, "...confirmTx...lockerScAddress: ", this.lockerScAddress);

        let mapConsumedUtxos = this.utxosManagerObj.getPendingComsumedUtxoByAddress(this.lockerScAddress);
        if (undefined === mapConsumedUtxos) {
            // this.logger.debug("..PlutusNftTxBuilder...", txHash, "...confirmTx...no pending utxos for: ", this.lockerScAddress);
            return;
        }

        // add exception catch for connector
        let txUtxos;
        try {
            txUtxos = await this.connector.txsUtxos(txHash);
            //  this.logger.debug("..PlutusNftTxBuilder...", txHash, "...confirmTx...tx utxos: ", txUtxos);
        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder...", txHash, "...confirmTx...get txsUtxos...error: ", e);
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
                // this.logger.debug("..PlutusNftTxBuilder...", txHash, "...confirmTx...pending list remove utxoId : ", utxoId);
                // mapConsumedUtxos.delete(utxoId);
                this.utxosManagerObj.deletePendingComsumedUtxoById(this.lockerScAddress, utxoId);
            }
        }

    }

    revertUtxoPendingComsumedStatus(inputUtxos) {
        this.utxosManagerObj.revertUtxoPendingComsumedStatus(inputUtxos);
    }


    ////////////////////////////////////////////
    //// PART 4: build cross-chain tx raw data
    ////////////////////////////////////////////
    async buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs) {
        this.logger.debug("..PlutusNftTxBuilder...buildSignedTx......basicArgs:", basicArgs);
        if (undefined === this.lockerScAddress) {
            let ret = await this.init();
            if (false === ret) {
                throw "failed to initial sdk!";
            }
        }

        //this.logger.debug("..PlutusNftTxBuilder...buildSignedTx......partialRedeemerArgs:", partialRedeemerArgs);
        this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...begin to build Signed Tx! ");
        this.paymentAddress = basicArgs.paymentAddress;
        this.paymentSkey = basicArgs.paymentSKey;

        // to add leader address for utxo manager
        this.utxosManagerObj.setSmgLeaderAddress(this.paymentAddress);
        this.utxosManagerObj.setNftTreasuryScAddress(this.lockerScAddress);

        //Step 1: to get groupInfoToken and fetch group pk
        let encodedGpk = this.commonUtil.encodeGpk(basicArgs.gpk);
        // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...this.groupInfoToken: ", this.groupInfoToken);
        if (this.groupPK !== encodedGpk) {
            // {
            this.groupInfoToken = await this.getGroupInfoToken();
            // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...getGroupInfoToken...: ", this.groupInfoToken);
            console.log("...getGroupInfoToken...: ", this.groupInfoToken);
            if (false === this.groupInfoToken) {
                throw "getGroupInfoToken: exception network during get group info token";
            }

            this.groupPK = this.contractService.getGroupPublicKey(this.groupInfoToken.datum);
            // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...groupInfoFromDatum...groupPK: ", this.groupPK);
            console.log("...groupInfoFromDatum...groupPK: ", this.groupPK);

            if (this.groupPK !== encodedGpk) {
                throw "inconsistent gpk";
            }
        }
        console.log("\n\n... this.groupPK: ", this.groupPK);

        // Step 2: to get cardano current netParams
        let bRet = await this.getCurChainParams();
        // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...getCurChainParams......bRet:", bRet);
        if (false === bRet) {
            throw "exception network during update protocal params";
        }

        // Step 3: to build cardano cross-chain tx
        let signedTx = await this.genSignedTxData(basicArgs, partialRedeemerArgs, internalSignFunc);
        // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...genSignedTxData......ret:", signedTx);
        return signedTx;
    }

    async genSignedTxData(basicArgs, partialRedeemerArgs, internalSignFunc) {
        // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...basicArgs: ", basicArgs);
        const owner = basicArgs.crossAddress;
        // to confirm transfer asset value
        const datum = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        /* Modify By NFT Program: 
            need to extend tokenId&tokenAmount to support multi-nft-tokens
            
            transferAmount:{
                tokenId_1: strTokenAmount_1,
                ...
                tokenId_n: strTokenAmount_n,
            }       
        */
        // assets: { [tokenId]: tokenAmount }
        const minAda = this.commonUtil.getMinAdaOfUtxo(this.protocolParams,
            owner,
            { coins: 0, assets: basicArgs.transferAmount },
            datum);
        // this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...getMinAdaOfUtxo: ", minAda, typeof (minAda));
        console.log("..PlutusNftTxBuilder......getMinAdaOfUtxo: ", minAda, typeof (minAda));

        // to build & sign normal cc tx or token mint tx by basciArgs params
        let buildRet = undefined;
        if (!basicArgs.bMint) {
            buildRet = await this.buildAndSignNftRawTx(internalSignFunc,
                basicArgs,
                minAda,
                partialRedeemerArgs);
        } else {
            buildRet = await this.buildAndSignNftMintRawTx(internalSignFunc,
                basicArgs,
                minAda,
                partialRedeemerArgs);
        }

        this.logger.debug("..PlutusNftTxBuilder...", basicArgs.hashX, "...buildAndSignRawTx...signedTxData: ", buildRet);
        return buildRet;
    }

    async buildAndSignNftRawTx(internalSignFunc, basicArgs, minAda, partialRedeemerArgs) {
        // console.log("\n\n..PlutusNftTxBuilder......buildAndSignNftRawTx basicArgs: ", basicArgs);
        const to = basicArgs.crossAddress;
        const metaData = basicArgs.metaData;
        const uniqueId = basicArgs.hashX;

        // Step 1: to get treasury utxos for ccTask
        this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...this.lockerScAddress: ", this.lockerScAddress);
        // Step 1-1: to coin select treasury utxos for transfer
        let transferAmount = new Array();
        /* Modify By NFT Program:  
            need to extend tokenId&tokenAmount to support multi-nft-tokens, 
        format is just like:            
            transferAmount:{
                tokenId_1: tokenAmount_1,
                ...
                tokenId_n: tokenAmount_n,
            }       
        */
        let nftPolicyId = "";
        const objNftAmount = basicArgs.transferAmount;
        for (let tokenId in objNftAmount) {
            let tokenAmount = objNftAmount[tokenId];
            let [policyId, name] = tokenId.split(".");
            let strTokenAmount = this.commonUtil.number2String(tokenAmount);
            let bnTokenAmount = CardanoWasm.BigNum.from_str(strTokenAmount);
            nftPolicyId = policyId;

            let amountItem = {
                "unit": policyId,
                "name": name,
                "amount": bnTokenAmount.to_str()
            };
            transferAmount.push(amountItem);
        }
        this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...transferAmount: ", transferAmount);

        // step 1-2: to select nft utxo for ccTask
        let selectedNftUtxos = new Array(); // the object of selectedNftUtxos should be formated utxo
        let totalUtxos = undefined;
        do {

            totalUtxos = await this.utxosManagerObj.getTotalUtxos(this.lockerScAddress);
            if (0 === totalUtxos.length) {
                // in case fail to get utxos or there is no available utxos
                await this.commonUtil.sleep(30 * 1000);
                continue;
            }

            let checkRet = this.utxosManagerObj.checkPreReservedUtxo(totalUtxos, uniqueId, transferAmount);
            // in case the task takes reserved utxo with pending available status
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "..checkPreReservedUtxo result..", checkRet);
            if ("PendingReserved" === checkRet.reservedStatus) {
                await this.commonUtil.sleep(30 * 1000);
                continue;
            }

            if (0 === checkRet.marginAmount.length) {
                let reservdUtxos = new Array();
                reservdUtxos.push(checkRet.reservedUtxo);
                selectedNftUtxos = this.commonUtil.formatUtxoData(reservdUtxos);
                break;
            }

            // step 1-3: in case of no suitable nft utxo 
            let ret = this.selectBalanceNftUtxos(checkRet.reservedUtxo, totalUtxos, checkRet.marginAmount, transferAmount);
            if (undefined !== ret) {
                // ret = {
                //     "selectedUtxos": selectedNftUtxos,
                //     "marginAmount": marginNftAmount,
                //     "targetAmount": targetNftAmount,
                // }
                if ((0 === ret.marginAmount.length) && (Config.PlutusCfg.maxUtxoNum >= ret.selectedUtxos.length)) {
                    // in case coinselection is failed and there are enough available utxos for task
                    selectedNftUtxos = ret.selectedUtxos;
                    break;
                } else {
                    let mergedTxId = await this.handleNftUtxosBalance(internalSignFunc, totalUtxos, ret.selectedUtxos, ret.targetAmount, uniqueId, nftPolicyId);
                    if (undefined === mergedTxId) {
                        console.log("\n\n...handleNftUtxosBalance mergedTxId is undefined! ");
                    }
                    await this.commonUtil.sleep(60 * 1000);
                }
            }


        } while (true);

        // Step 1-4: combine selectedUtxos with target balanced utxos
        ////// Step 2-5: to get utxos for fee && collateral
        /* Modify By NFT Program: 
            need to expend the parseTreasuryUtxoChangeData params to support multi-nft transfer amount
            
            this.protocolParams,
            formatedUtxos, 
            transferNftAmount, 
            this.lockerScAddress);
        */
        let treasuryUtxo = this.commonUtil.filterUtxosFromFormatedUtxos(totalUtxos, selectedNftUtxos);
        this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...selected treasury Utxo: ", JSON.stringify(treasuryUtxo));
        let treasuryUtxoChangeInfo = this.commonUtil.parseTreasuryNftUtxoChangeData(
            this.protocolParams,
            selectedNftUtxos,
            transferAmount,
            this.lockerScAddress);
        if (undefined === treasuryUtxoChangeInfo) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            throw "coin select treasury utxo amount is not enough for transferAmount  for uniqueId: " + uniqueId;
        }
        // let txOutputNum = treasuryUtxoChangeInfo.outputNum;
        let marginAda = treasuryUtxoChangeInfo.marginAda;
        // let adaAmount = treasuryUtxoChangeInfo.mergedBindAda;
        // let mapMergedAmount = treasuryUtxoChangeInfo.mergedAmount;
        console.log("\n\n...parseTreasuryNftUtxoChangeData treasuryUtxoChangeInfo: ", treasuryUtxoChangeInfo);

        // Step 2: to get treasury data
        // Step 2-1: treasuryCheckRef&&Uxto 
        const treasuryCheckVH = this.contractService.getTreasuryCheckVH(this.groupInfoToken.datum);
        console.log("\n\n...parseTreasuryNftUtxoChangeData treasuryCheckVH: ", treasuryCheckVH);
        if (undefined == treasuryCheckVH) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            throw "failed to get treasury check VH for uniqueId: " + uniqueId;
        }

        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        console.log("\n\n...parseTreasuryNftUtxoChangeData checkRefData: ", checkRefData);
        if (undefined == checkRefData) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            throw "empty treasury check ref utxo  for uniqueId: " + uniqueId;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;

        // Step 2-2: treasury Ref utxo
        // NFT program modify: getTreasuryScript --> getNftTreasuryScript
        const treasuryScript = this.contractService.getTreasuryScript();
        let treasuryRef = await this.getScriptRefUtxo(treasuryScript);
        if (undefined === treasuryRef) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo");
            throw "empty treasury ref utxo  for uniqueId: " + uniqueId;
        }
        this.logger.debug("..PlutusNftTxBuilder...",
            uniqueId,
            `...transferValue Treasury ref utxo: ${treasuryRef.txHash + '#' + treasuryRef.index}`);

        // Step 3: to get payment from leader
        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT).checked_add(marginAda);
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            to,
            feeValue,
            undefined);
        if (undefined === paymentUtxosRet) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo.");
            throw "failed to get leader utxos for fee  for uniqueId: " + uniqueId;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo.");
            throw "insufficent leader utxos for fee  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...utxosForFee: ", utxosForFee);

        //TODO：utxosForFee 
        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        const nonce = {
            "txHash": treasuryCheckUxto.txHash,
            "index": treasuryCheckUxto.index
        };

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...convertSlotToTimestamp failed: ", err);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release utxosForFee.");

            throw err;
        }

        // Step 4: to get inner sign by mpc
        let crossValue = {
            "coins": minAda,
            "assets": basicArgs.transferAmount
        };
        const redeemerProof = {
            to, crossValue: crossValue, policy_id: nftPolicyId,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode,
            txType: Config.TaskType.crossTask, uniqueId: uniqueId,
            signature: '', ttl: ttl2Ts, txTTL: validTTL
        };
        this.logger.debug(".....PlutusNftTxBuilder...", uniqueId, "...redeemerProof: ", JSON.stringify(redeemerProof));
        console.log("\n\n.....PlutusNftTxBuilder......redeemerProof: ", JSON.stringify(redeemerProof));

        try {
            const redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, false);
            this.logger.debug(".....PlutusNftTxBuilder...", uniqueId, "...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
            // console.log("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftRawTx internalSignFunc: ", signature);
        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftRawTx internalSignFunc exception: ", e);

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release utxosForFee.");

            throw e;
        }

        // Step 5: to build transfer value
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftRawTx transferValue: ", transferValue);
        try {
            const signedTxOutBound = await this.contractService.transferFromTreasury(this.protocolParams, utxosForFee,
                treasuryUtxo, treasuryRef, this.groupInfoToken, redeemerProof, utxosForFee,
                treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this), this.signFn.bind(this),
                metaData, validTTL);

            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftRawTx signedTxOutBound finished. ");
            return signedTxOutBound;

        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftRawTx error: ", e);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release object contains treasury Utxo: ", JSON.stringify(treasuryUtxo));

            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(treasuryUtxo);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release utxosForFee.");

            throw e;
        }
    }

    async buildAndSignNftMintRawTx(internalSignFunc, basicArgs, minAda, partialRedeemerArgs) {
        const to = basicArgs.crossAddress;
        const metaData = basicArgs.metaData;
        const uniqueId = basicArgs.hashX;
        const nftRefAssets = basicArgs.nftRefAssets; // 
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftMintRawTx current slot: ", this.curChainTip.slot);
        // Step 1-1: to coin select treasury utxos for transfer
        let transferAmount = new Array();
        /* Modify By NFT Program:  
            need to extend tokenId&tokenAmount to support multi-nft-tokens, 
        format is just like:            
            transferAmount:{
                tokenId_1: tokenAmount_1,
                ...
                tokenId_n: tokenAmount_n,
            }       
        */
        const objNftAmount = basicArgs.transferAmount;
        let mappingPolicyId = "";
        for (let tokenId in objNftAmount) {
            let tokenAmount = objNftAmount[tokenId];
            let [policyId, name] = tokenId.split(".");
            let strTokenAmount = this.commonUtil.number2String(tokenAmount);
            let bnTokenAmount = CardanoWasm.BigNum.from_str(strTokenAmount);

            mappingPolicyId = policyId;

            let amountItem = {
                "name": name,
                "amount": bnTokenAmount.to_str()
            };
            transferAmount.push(amountItem);
        }
        this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...transferAmount: ", transferAmount);

        // Step 1: to get treasury data     
        let mintCheckVH = this.contractService.getTreasuryMintCheckVH(this.groupInfoToken.datum);

        // Step 1-1: treasuryCheckRef&&Uxto 
        let mintCheckRefData = await this.getTreasuryCheckRefAndAvailableUtxo(mintCheckVH, true);
        if (undefined == mintCheckRefData) {
            throw "empty mint check ref or utxo  for uniqueId: " + uniqueId;
        }
        let mintCheckUxto = mintCheckRefData.checkUtxo;
        let mintCheckRef = mintCheckRefData.checkRef;
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...mint check Treasury ref utxo: ", mintCheckUxto, mintCheckRef);        

        // Step 1-2: treasury Ref utxo
        let mappingTokenRef = await this.getScriptRefUtxo4MappingToken(mappingPolicyId);
        if (undefined === mappingTokenRef) {
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            throw "empty mapping token script ref  for uniqueId: " + uniqueId;
        }
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, `...transferValue Treasury ref utxo: ${mappingTokenRef.txHash + '#' + mappingTokenRef.index}`);

        // Step 2: to get leader utxos for mint fee
        let feeValue = new Array();
        let feeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT);
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": feeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            to,
            feeValue,
            undefined);
        if (undefined === paymentUtxosRet) {
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            throw "get leader utxos failed for mint tx fee  for uniqueId: " + uniqueId;
        }

        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
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
        //this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...utxos For Fee & Collateral: ", utxosForFee, collateralUtxos);

        //TODO：utxosForFee 应该是个数组?--fixed
        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        // const nonce = { txHash: mintCheckUxto.txHash, index: mintCheckUxto.index };
        const nonce = {
            "txHash": mintCheckUxto.txHash,
            "index": mintCheckUxto.index
        };

        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftMintRawTx convertSlotToTimestamp exception: ", err);

            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw err;
        }

        const redeemerProof = {
            uniqueId: uniqueId, mode: this.signMode, txHash: nonce.txHash, index: nonce.index,
            to: to, policy_id: mappingPolicyId, nftAssets: transferAmount,
            signature: '', ttl: ttl2Ts, txTTL: validTTL,
            nftRefAssets: nftRefAssets, // nftRefAssets: provide by agent
            userData: undefined
        };

        try {
            const redeemProofHash = this.contractService.caculateRedeemDataHash(redeemerProof, true);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...caculateRedeemDataHash: ", redeemProofHash);

            let signature = await internalSignFunc(partialRedeemerArgs, redeemerProof, redeemProofHash);
            redeemerProof.signature = signature;
        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftMintRawTx internalSignFunc exception: ", e);
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw e;
        }

        // Step 4: to build mint value
        try {
            // nftRefHolderAddr
            const signedTxOutBound = await this.contractService.mint(this.protocolParams, utxosForFee, collateralUtxos, mappingTokenRef,
                mintCheckRef, this.groupInfoToken, mintCheckUxto, redeemerProof, this.nftRefHolderAddr, this.paymentAddress,
                this.evaluateFn.bind(this), this.signFn.bind(this), validTTL, metaData);

            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftMintRawTx...signedTxOutBound finished. ");
            return signedTxOutBound;
        } catch (e) {
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...buildAndSignNftMintRawTx error: ", e);
            this.utxosManagerObj.releaseUtxos(mintCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release mint check Utxo: ", mintCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release utxosForFee: ", utxosForFee);
            throw e;
        }
    }

    ////////////////////////////////////////////
    //// PART 5: Utxo Balanced Processing Funs
    ////////////////////////////////////////////
    caculateUtxoPriorityByAssetMask(assetMask, formatUtxos) {
        console.log("..caculateUtxoPriorityByAssetMask assetMask: ", assetMask);

        let utxoPriorityAry = new Array();

        for (let i = 0; i < formatUtxos.length; i++) {

            let utxoPriority = 0;
            let mapUtxoAssetInfo = new Map();

            let utxoItem = formatUtxos[i];
            console.log("..caculateUtxoPriorityByAssetMask utxoItem: ", utxoItem);
            let utxoId = this.commonUtil.encodeUtxo(utxoItem).to_hex();

            let outputs = utxoItem.txOut;
            for (let j = 0; j < outputs.value.length; j++) {
                let itemAsset = outputs.value[j];
                let strItemAmount = itemAsset.quantity;

                // to check if asset type matched
                let strAssetAmount = assetMask.get(itemAsset.unit); // the unit takes no '.' 
                if (undefined !== strAssetAmount) {
                    let amountPriority = 0;

                    let bnAssetAmount = CardanoWasm.BigNum.from_str(strAssetAmount);
                    let bnItemAmount = CardanoWasm.BigNum.from_str(strItemAmount);
                    // let ret = bnItemAmount.compare(bnAssetAmount);                    
                    if (0 > bnItemAmount.compare(bnAssetAmount)) {
                        amountPriority = parseInt(strItemAmount); // the amount is less than required amount                    
                    } else {
                        amountPriority = parseInt(strAssetAmount); // the amount satisfy required amount
                    }

                    // to count the priority of asset amount
                    utxoPriority = utxoPriority + amountPriority;
                    // to statistic the related asset info of this utxo
                    mapUtxoAssetInfo[itemAsset.unit] = strItemAmount; // the unit takes no '.' 
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

    caculateNftUtxosPriority(formatUtxos, transferNftAmount) {
        // step 1: to generate asset mask based on transferNftAmount
        let mapAssetMask = this.commonUtil.genAssetMaskByAmount(transferNftAmount);

        // step 2: to caculate utxo priority based on assetMask
        let utxoPriorityAry = this.caculateUtxoPriorityByAssetMask(mapAssetMask, formatUtxos);

        // step 3: to sort the utxos by priority
        utxoPriorityAry.sort(this.commonUtil.compareByProperty("priority"));

        return utxoPriorityAry;
    }

    getTargetUtxoForNftBalance(availableUtxos, nftAmount) {

        // to parse the priority of available nft utxos
        let utxoPriorityAry = this.caculateNftUtxosPriority(availableUtxos, nftAmount);
        if ((undefined === utxoPriorityAry) || (0 === utxoPriorityAry.length)) {
            return undefined;
        }
        console.log("\n\n...getTargetUtxoForNftBalance caculateNftUtxosPriority: ", utxoPriorityAry);

        // to return the utxo with the highest priority 
        let targetUtxo = utxoPriorityAry[0];
        console.log("...getTargetUtxoForNftBalance targetUtxo: ", targetUtxo);
        return targetUtxo;
    }

    selectBalanceNftUtxos(reservdUtxo, totalUtxos, marginAmount, transferAmount) {
        // step 1: to check if takes available nft utxos out of pending comsumed utxos or preReserved utxos
        let formatedUtxos = this.utxosManagerObj.checkAvailableUtxos(this.lockerScAddress, totalUtxos, false, undefined, true);
        // let formatedUtxos = this.commonUtil.formatUtxoData(availableUtxos);

        let selectedNftUtxos = new Array(); // the object of selectedNftUtxos should be formated utxo
        if (undefined !== reservdUtxo) {
            let aryReservdUtxos = new Array();
            aryReservdUtxos.push(reservdUtxo); // reservdUtxo is pre-formated utxo
            selectedNftUtxos = this.commonUtil.formatUtxoData(aryReservdUtxos);
        }

        let nftAmount = marginAmount;
        // in case need to select more suitable utxo for balance
        let marginNftAmount = undefined;
        do {
            if (Config.PlutusCfg.maxUtxoNum <= selectedNftUtxos.length) {
                marginNftAmount = nftAmount;
                console.log("....selectBalanceNftUtxos..selected NftUtxos num: ", selectedNftUtxos.length);
                break;
            }

            // Step 2: to filter the most suitable utxos for merge
            // to sort the nftAmount by amount
            nftAmount.sort(this.commonUtil.compareByProperty("amount"));

            // to get the suitable with the top priority for nft balance
            let utxoPriorityAry = this.caculateNftUtxosPriority(formatedUtxos, nftAmount);
            let targetUtxoObj = utxoPriorityAry[0];
            if (undefined === targetUtxoObj) {
                return undefined;
            }

            // step 3:  udpate availableUtxos:  split this utxo away from array
            for (let j = 0; j < formatedUtxos.length; j++) {
                let utxoObj = formatedUtxos[j];
                let utxoId = this.commonUtil.encodeUtxo(utxoObj).to_hex();

                if (targetUtxoObj.utxoId === utxoId) {
                    selectedNftUtxos.push(utxoObj);
                    // remove this utxo from availableUtxos list
                    formatedUtxos.splice(j, 1);
                    break;
                }
            }

            // update nftAmount: 
            let tmpMarginNftAmount = this.commonUtil.caculateMarginNftAmount(nftAmount, targetUtxoObj);
            if (0 === tmpMarginNftAmount.length) {
                // has reached the transfer amount
                marginNftAmount = tmpMarginNftAmount;
                break;
            }
            nftAmount = tmpMarginNftAmount;

        } while (true);

        // Step 4: to mark the status of selected utxos as pendingConsumed
        for (let i = 0; i < selectedNftUtxos.length; i++) {
            let formatedUtxoObj = selectedNftUtxos[i];
            // to add new pending consumed utxos
            this.utxosManagerObj.appendPendingComsumedUtxo(this.lockerScAddress, formatedUtxoObj, this.curChainTip.slot);
        }

        let targetNftAmount = this.commonUtil.caculateTargetNftAmount(transferAmount, marginNftAmount);
        // Step 5: to return the merged-balance selection result
        let ret = {
            "selectedUtxos": selectedNftUtxos,  // selected utxos for nft-merged-balance
            "marginAmount": marginNftAmount,    // the margin amounts after merged-balance
            "targetAmount": targetNftAmount // the target amounts of merged-balance 
        }
        console.log("....selectBalanceNftUtxos..result: ", ret);
        this.logger.debug("..PlutusNftTxBuilder...selectBalanceNftUtxos...result: ", ret);
        return ret;
    }

    // selectedFormatedUtxos is formated utxo objects for balance 
    async handleNftUtxosBalance(internalSignFunc, totalUtxos, selectedFormatedUtxos, transferNftAmount, uniqueId, nftPolicyId) {

        if (undefined === this.lockerScAddress) {
            this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...failed to initial sdk!");
            let ret = await this.init();
            if (false === ret) {
                return undefined;
            }
        }

        let bRet = await this.getCurChainParams();
        if (false === bRet) {
            return undefined;
        }

        let targetUtxos = this.commonUtil.filterUtxosFromFormatedUtxos(totalUtxos, selectedFormatedUtxos);

        let nftAssets = {};
        for (let i = 0; i < transferNftAmount.length; i++) {
            let nftUnit = transferNftAmount[i].unit + "." + transferNftAmount[i].name;
            let nftAmount = transferNftAmount[i].amount;
            nftAssets[nftUnit] = nftAmount;
        }

        // Step 1: to get treasury checkVH by datum        
        let treasuryCheckVH = this.contractService.getTreasuryCheckVH(this.groupInfoToken.datum);
        if (undefined == treasuryCheckVH) {
            this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...getTreasuryCheckVH...warning: EmptyCheckUtxo");
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            return undefined;
        }
        console.log("..PlutusNftTxBuilder...handleNftUtxosBalance...treasuryCheckVH: ", treasuryCheckVH);

        // Step 1-1: to get treasury check ref and utxo
        let checkRefData = await this.getTreasuryCheckRefAndAvailableUtxo(treasuryCheckVH, false);
        if (undefined == checkRefData) {
            this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...getTreasuryCheckRefAndAvailableUtxo...warning: EmptyCheckUtxo");
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            return undefined;
        }
        let treasuryCheckUxto = checkRefData.checkUtxo;
        let treasuryCheckRef = checkRefData.checkRef;
        const treasuryScript = this.contractService.getTreasuryScript();

        // Step 1-2: to get treasury ref and utxo
        let treasuryRef = await this.getScriptRefUtxo(treasuryScript);
        if (undefined === treasuryRef) {
            this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...getScriptRefUtxo...warning:.EmptyScriptRefUtxo");
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            return undefined;
        }
        this.logger.debug(`..PlutusNftTxBuilder...handleNftUtxosBalance...transferValue Treasury ref utxo: ${treasuryRef.txHash + '#' + treasuryRef.index}`);

        // Step 1-4: to caculate the total assert value of targetUtxos
        // let formatedUtxos = this.commonUtil.formatUtxoData(targetUtxos);
        let treasuryUtxoChangeInfo = this.commonUtil.parseTreasuryNftUtxoChangeData(
            this.protocolParams,
            selectedFormatedUtxos,
            transferNftAmount,
            this.lockerScAddress);
        if (undefined === treasuryUtxoChangeInfo) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury check Utxo.");
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            this.logger.debug("..PlutusNftTxBuilder...", uniqueId, "...release treasury Utxo.");
            return undefined;
        }
        let outputNum = treasuryUtxoChangeInfo.outputNum;
        let marginAda = treasuryUtxoChangeInfo.marginAda;
        let minMergedBindAda = treasuryUtxoChangeInfo.mergedBindAda;
        let objMergedAmount = treasuryUtxoChangeInfo.mergedAmount;

        // Step 2: to caculate the max fee for balanced tx, on leader account.
        console.log("\n\n\n..PlutusNftTxBuilder...handleNftUtxosBalance...begin to get utxosForFee: ");
        let bnFeeAmount = CardanoWasm.BigNum.from_str(LEADER_FEE_AMOUNT).checked_add(marginAda);
        let feeValue = new Array();
        let valueItem = {
            "unit": "lovelace",
            "name": "",
            "amount": bnFeeAmount.to_str()
        };
        feeValue.push(valueItem);
        // this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...begin feeValue: ", feeValue);

        let paymentUtxosRet = await this.utxosManagerObj.getUtxoOfAmount(this.paymentAddress,
            this.lockerScAddress,
            feeValue,
            undefined);
        if (undefined === paymentUtxosRet) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...getUtxoOfAmount...warning: get UtxoForFee failed");
            return undefined;
        }
        let utxosForFee = paymentUtxosRet.selectedUtxos;
        if (0 === utxosForFee.length) {
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...getUtxoOfAmount...warning: inSufficent Utxo For Fee");
            return undefined;
        }
        // this.logger.debug("..PlutusNftTxBuilder...handleNftUtxosBalance...utxosForFee: ", utxosForFee);
        console.log("..PlutusNftTxBuilder...handleNftUtxosBalance...utxosForFee: ", utxosForFee);

        // Step 3: add tx input based on utxo data  
        let validTTL = this.curChainTip.slot + Config.MaxTxTTL;
        let ttl2Ts = validTTL;
        try {
            ttl2Ts = await this.convertSlotToTimestamp(validTTL);
        } catch (err) {
            console.log("..PlutusNftTxBuilder...handleNftUtxosBalance..convertSlotToTimestamp exception: ", err);
            return undefined;
        }
        // this.logger.debug("..PlutusNftTxBuilder......handleNftUtxosBalance...validTTL: ", validTTL);
        console.log("..PlutusNftTxBuilder...handleNftUtxosBalance...converted ttl2Ts: ", ttl2Ts);

        const nonce = {
            "txHash": treasuryCheckUxto.txHash,
            "index": treasuryCheckUxto.index
        };
        const transferValue = {
            "coins": minMergedBindAda.to_str(),
            "assets": nftAssets
        };


        const redeemerProof = {
            to: this.lockerScAddress, crossValue: transferValue, policy_id: nftPolicyId,
            txHash: nonce.txHash, index: nonce.index, mode: this.signMode, signature: '',
            txType: Config.TaskType.balancedTask, uniqueId: uniqueId, ttl: ttl2Ts, txTTL: validTTL
        };
        // special handle for multiSig in balanceTx-redeemProof 
        redeemerProof.signature = BalanceTxMultiSig;
        this.logger.debug(".....PlutusNftTxBuilder...handleNftUtxosBalance...redeemerProof: ", JSON.stringify(redeemerProof));

        // Step 4: to build transaction with related params
        this.logger.debug("..PlutusNftTxBuilder......handleNftUtxosBalance...transferFromTreasury: ", transferValue);
        let metaData = {
            // empty metaData info is just ok
        };
        let signedTxOutBound = undefined;
        try {
            signedTxOutBound = await this.contractService.transferFromTreasury(this.protocolParams, utxosForFee,
                targetUtxos, treasuryRef, this.groupInfoToken, redeemerProof,
                utxosForFee, treasuryCheckUxto, treasuryCheckRef, this.paymentAddress, this.evaluateFn.bind(this),
                this.signFn.bind(this), metaData, validTTL);


        } catch (e) {
            this.logger.error("..PlutusNftTxBuilder......transferFromTreasury...e: ", e);
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            return undefined; //throw e;
        }

        if (undefined === signedTxOutBound) {
            this.utxosManagerObj.releaseUtxos(targetUtxos);
            this.utxosManagerObj.releaseUtxos(treasuryCheckUxto);
            this.utxosManagerObj.releaseUtxos(utxosForFee);
            return undefined;
        }

        // Step 4: to submit the signed tx
        let txId = undefined
        try {
            txId = await this.connector.sendRawTransaction(signedTxOutBound.to_bytes());
            this.logger.debug("..PlutusTxBuilder......handleNftUtxosBalance......sendRawTransaction :", txId);

            this.utxosManagerObj.deletePreReservedUtxoInfo(uniqueId);
            let txBodyHash = CardanoWasm.hash_transaction(signedTxOutBound.body());
            let balanceTxId = Buffer.from(txBodyHash.to_bytes()).toString('hex');
            console.log("balance tx Id: ", balanceTxId);
            const reseredUtxoIndex = 1;
            let strMinBindAda = minMergedBindAda.to_str();
            this.logger.debug("..PlutusNftTxBuilder......handleNftUtxosBalance...mergedAmount: ", JSON.stringify(objMergedAmount));
            let reservedUtxo = this.commonUtil.genFormatedUtxo(balanceTxId, reseredUtxoIndex, this.lockerScAddress, strMinBindAda, objMergedAmount);
            let reservedUtxoId = this.commonUtil.encodeUtxo(reservedUtxo).input().to_hex();
            let reservedInfo = {
                "reservedTxId": uniqueId,
                "reservedAmount": objMergedAmount,
                "reservedSlot": this.curChainTip.slot
            }
            this.utxosManagerObj.appendPreReservedUtxoInfo(reservedUtxoId, reservedInfo);
            this.logger.debug("..PlutusNftTxBuilder......handleNftUtxosBalance...appendPreReservedUtxoInfo: ", reservedUtxoId, JSON.stringify(reservedInfo));
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder......handleNftUtxosBalance......sendRawTransaction error :", e);
        }
        return txId;

    }

    ///////////////////////////////////
    //// PART 6: tx related functions
    ///////////////////////////////////
    signFn(hash) {
        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(this.paymentSkey, 'hex'));
        const signature = payPrvKey.sign(Buffer.from(hash, 'hex')).to_hex();
        const vkey = payPrvKey.to_public().to_bech32();
        // this.logger.debug("..PlutusNftTxBuilder......signFn: ", vkey, signature);
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
            this.logger.debug("..PlutusNftTxBuilder......evaluateTx error: ", e);
            throw e;
        }
    }

}


module.exports = PlutusNftTxBuilder;
