const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const Common = require('../util/common');
const Config = require('../config');
const NFTContract = require('../cross-chain-js/nft-contract');
const ContractsMgr = require('../cross-chain-js/contracts-mgr');
const ContractUtils = require('../cross-chain-js/utils');

class NFTContractService {

    constructor(bMainnet, addrPrefix, logUtil) {
        this.ADDR_PREFIX = addrPrefix;
        this.commonUtil = new Common(addrPrefix);

        this.network_id = CardanoWasm.NetworkInfo.testnet_preprod().network_id();
        if (bMainnet) {
            // this.ADDR_PREFIX = Config.PlutusCfg.mainnetPrefix;
            this.network_id = CardanoWasm.NetworkInfo.mainnet().network_id();
        }

        NFTContract.init(bMainnet);
        ContractsMgr.init(bMainnet);
                        
        this.validCheckTokenPolicyId = NFTContract.NFTTreasuryCheckTokenScript.policy_id();
        this.validMappingCheckTokenPolicyId = NFTContract.NFTMintCheckTokenScript.policy_id();

        this.logger = logUtil;
    }

    getLockerScAddress(stakeCred) {
        this.lockerScAddress = NFTContract.NFTTreasuryScript.address(stakeCred).to_bech32(this.ADDR_PREFIX);
        return this.lockerScAddress;
    }

    getSignMode() {

        if (0 === Config.SignAlgorithmMode) {
            this.signMode = NFTContract.NFTTreasuryScript.MODE_ECDSA;
        } else if (2 === Config.SignAlgorithmMode) {
            this.signMode = NFTContract.NFTTreasuryScript.MODE_ED25519;
        } else {
            this.signMode = NFTContract.NFTTreasuryScript.MODE_SCHNORR340;
        }

        return this.signMode;
    }

    getValidPolicyId() {
        this.validPolicyId = NFTContract.NFTMappingTokenScript.policy_id();
        return this.validPolicyId
    }

    getTreasuryScript() {
        let treasuryScript = NFTContract.NFTTreasuryScript.script();
        return treasuryScript;
    }

    getRefHolderScript() {
        let nftRefHolderAddr = NFTContract.NFTRefHolderScript.address();
        return nftRefHolderAddr;
    }

    getMappingTokenScript() {
        let tokenScript = NFTContract.NFTMappingTokenScript.script();
        return tokenScript;
    }

    addressToPkhOrScriptHash(address) {
        let phk = ContractUtils.addressToPkhOrScriptHash(address);
        return phk;
    }

    getMintCheckTokenPolicyId() {
        let mPolicyId = NFTContract.NFTMintCheckTokenScript.policy_id();
        return mPolicyId;
    }

    getCheckTokenPolicyId() {
        let policyId = NFTContract.NFTTreasuryCheckTokenScript.policy_id();
        return policyId;
    }

    caculateRedeemDataHash(redeemerProof, bMintCheck) {

        let redeemProofHash = undefined;
        if (bMintCheck) {
            redeemProofHash = NFTContract.NFTMintCheckScript.caculateRedeemDataHash(redeemerProof);
        } else {
            redeemProofHash = NFTContract.NFTTreasuryCheckScript.caculateRedeemDataHash(redeemerProof);
        }

        return redeemProofHash;
    }

    deCodeTxRedeemersCbor(txInfo, txUtxos, bMintCheck) {

        let tokenPolicyId = NFTContract.NFTTreasuryCheckTokenScript.policy_id();
        if (bMintCheck) {
            tokenPolicyId = NFTContract.NFTMintCheckTokenScript.policy_id();
        }

        let redeemer = undefined;
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

                if (tokenPolicyId === assetUnitInfo[0]) {
                    let redeemerKey = "spend:" + i;
                    let redeemerInfo = txInfo.redeemers[redeemerKey];
                    if (undefined === redeemerInfo) {
                        continue;
                    }

                    if (bMintCheck) {
                        redeemer = NFTContract.NFTMintCheckScript.getMintRedeemerFromCBOR(redeemerInfo.redeemer);
                    } else {
                        redeemer = NFTContract.NFTTreasuryCheckScript.getCrossRedeemerFromCBOR(redeemerInfo.redeemer);
                    }
                    return redeemer;
                }
            }
        }

        return undefined;
    }

    getGroupInfoStkVh(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let StkVh = groupInfo[ContractsMgr.GroupNFT.StkVh];
        this.logger.debug("..NFTContractService...getGroupInfoStkVh...StkVh: ", StkVh);
        console.log("..groupInfoFromDatum StkVh: ", StkVh);
        return StkVh;
    }

    getGroupPublicKey(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let groupPK = groupInfo[ContractsMgr.GroupNFT.GPK];
        //this.logger.debug("..NFTContractService...getGroupPublicKey...groupPK: ", groupPK);
        return groupPK;
    }

    getTreasuryCheckVH(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let treasuryCheckVH = groupInfo[ContractsMgr.GroupNFT.NFTTreasuryCheckVH];
        //this.logger.debug("..NFTContractService...getTreasuryCheckVH...treasuryCheckVH: ", treasuryCheckVH);
        return treasuryCheckVH;
    }

    getTreasuryMintCheckVH(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let mintCheckVH = groupInfo[ContractsMgr.GroupNFT.NFTMintCheckVH];
        //this.logger.debug("..NFTContractService...getTreasuryMintCheckVH...mintCheckVH: ", mintCheckVH);
        return mintCheckVH;
    }

    getTreasuryCheckAddress(bMintCheck, groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let checkStkVh = groupInfo[ContractsMgr.GroupNFT.StkVh];
        // this.logger.debug("..NFTContractService...getTreasuryCheckAddress...stkVh: ", checkStkVh);

        let vhItemName = bMintCheck ? ContractsMgr.GroupNFT.NFTMintCheckVH : ContractsMgr.GroupNFT.NFTTreasuryCheckVH;
        let checkPayVh = groupInfo[vhItemName];
        // this.logger.debug("..NFTContractService...getTreasuryCheckAddress...checkPayVh: ", bMintCheck, vhItemName, checkPayVh);

        let checkStkKeyHash = CardanoWasm.ScriptHash.from_hex(checkStkVh); //Ed25519KeyHash
        let checkPayKeyHash = CardanoWasm.ScriptHash.from_hex(checkPayVh);

        let checkAddress = CardanoWasm.BaseAddress.new(
            this.network_id,
            CardanoWasm.Credential.from_scripthash(checkPayKeyHash),
            CardanoWasm.Credential.from_scripthash(checkStkKeyHash) //from_keyhash
        );

        let strCheckAddress = checkAddress.to_address().to_bech32(this.ADDR_PREFIX);
        // this.logger.debug("..NFTContractService...getTreasuryCheckAddress...strCheckAddress: ", strCheckAddress);
        if (bMintCheck) {
            let mintCheckTokenPolicyId = NFTContract.NFTMintCheckTokenScript.policy_id();
            // this.logger.debug("..NFTContractService...getTreasuryCheckAddress...mintCheckTokenPolicyId: ", mintCheckTokenPolicyId);
        } else {
            let checkTokenPolicyId = NFTContract.NFTTreasuryCheckTokenScript.policy_id();
            // this.logger.debug("..NFTContractService...getTreasuryCheckAddress...checkTokenPolicyId: ", checkTokenPolicyId);
        }
        return strCheckAddress;
    }

    getGroupInfoHolder() {
        const groupInfoHolder = ContractsMgr.GroupInfoNFTHolderScript.address().to_bech32(this.ADDR_PREFIX);
        // this.logger.debug("..NFTContractService......GroupInfoNFTHolderScript address: ", groupInfoHolder);
        console.log("..NFTContractService......GroupInfoNFTHolderScript address: ", groupInfoHolder);

        let expectedTokenId = ContractsMgr.GroupNFT.tokenId(); // need liulin confirm
        expectedTokenId = expectedTokenId.replace(".", "");
        console.log("..NFTContractService......GroupInfoNFTHolderScript address: ", expectedTokenId);

        let ret = {
            "groupHolder": groupInfoHolder,
            "tokenId": expectedTokenId
        }
        return ret;
    }

    async transferFromTreasury(protocolParams, utxosForFee, utxosToSpend, scriptRefUtxo, groupNFTUtxo, redeemProof, utxoForCollateral,
        treasuryCheckUxto, treasuryCheckRef, changeAddress, evaluateFn, signFn, rawMetaData, ttl) {

        try {
            const signedTxOutBound = await NFTContract.NFTTreasuryScript.transferFromTreasury(protocolParams, utxosForFee, utxosToSpend,
                scriptRefUtxo, groupNFTUtxo, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef,
                changeAddress, evaluateFn, signFn, rawMetaData, ttl);

            // this.logger.debug("..NFTContractService......transferFromTreasury address: ", groupInfoHolder);
            return signedTxOutBound;
        } catch (e) {
            // this.logger.debug("..NFTContractService......transferFromTreasury address: ", groupInfoHolder);
            throw e;
        }
    }

    async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof,
        nftRefHolderAddr, changeAddress, evaluateFn, signFn, ttl, rawMetaData) {

        try {
            const signedTxOutBound = await NFTContract.NFTMappingTokenScript.mint(protocolParams, utxosForFee, utxoForCollateral,
                scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, nftRefHolderAddr, changeAddress,
                evaluateFn, signFn, ttl, rawMetaData);

            this.logger.debug("..NFTContractService...buildAndSignNftMintRawTx...signedTxOutBound finished. ");
            return signedTxOutBound;
        } catch (e) {
            this.logger.debug("..NFTContractService...buildAndSignNftMintRawTx error: ", e);
            throw e;
        }
    }

    genNFTIdFromAssetName(assetNameHex) {
        let phk = ContractUtils.genNFTIdFromAssetName(assetNameHex);
        return phk;
    }

    genNFTAssetName(nameHex, typeCode) {
        let phk = ContractUtils.genNFTAssetName(nameHex, typeCode);
        return phk;
    }

}


module.exports = NFTContractService;
