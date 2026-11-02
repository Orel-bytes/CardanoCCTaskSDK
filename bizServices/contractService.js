const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const Common = require('../util/common');
const Config = require('../config');
const Contracts = require('../cross-chain-js/contracts');
const ContractsMgr = require('../cross-chain-js/contracts-mgr');
const ContractUtils = require('../cross-chain-js/utils');

class ContractService {

    constructor(bMainnet, addrPrefix, logUtil) {
        this.ADDR_PREFIX = addrPrefix;
        this.commonUtil = new Common(addrPrefix);

        this.network_id = CardanoWasm.NetworkInfo.testnet_preprod().network_id();
        if (bMainnet) {
            // this.ADDR_PREFIX = Config.PlutusCfg.mainnetPrefix;
            this.network_id = CardanoWasm.NetworkInfo.mainnet().network_id();
        }
        CardanoWasm.CredKind.

        Contracts.init(bMainnet);
        // ContractsMgr.init(bMainnet);
                
        this.validCheckTokenPolicyId = Contracts.TreasuryCheckTokenScript.policy_id();
        this.validMappingCheckTokenPolicyId = Contracts.MintCheckTokenScript.policy_id();

        this.logger = logUtil;
    }


    getLockerScAddress(stakeCred) {
        this.lockerScAddress = Contracts.TreasuryScript.address(stakeCred).to_bech32(this.ADDR_PREFIX);
        return this.lockerScAddress;
    }

    getSignMode() {

        if (0 === Config.SignAlgorithmMode) {
            this.signMode = Contracts.TreasuryScript.MODE_ECDSA;
        } else if (2 === Config.SignAlgorithmMode) {
            this.signMode = Contracts.TreasuryScript.MODE_ED25519;
        } else {
            this.signMode = Contracts.TreasuryScript.MODE_SCHNORR340;
        }

        return this.signMode;
    }

    getValidPolicyId() {
        this.validPolicyId = Contracts.MappingTokenScript.policy_id();
        return this.validPolicyId
    }

    getTreasuryScript() {
        let treasuryScript = Contracts.TreasuryScript.script();
        return treasuryScript;
    }

    getMappingTokenScript() {
        let tokenScript = Contracts.MappingTokenScript.script();
        return tokenScript;
    }

    addressToPkhOrScriptHash(address) {
        let phk = ContractUtils.addressToPkhOrScriptHash(address);
        return phk;
    }

    getMintCheckTokenPolicyId() {
        let mPolicyId = Contracts.MintCheckTokenScript.policy_id();
        return mPolicyId;
    }

    getCheckTokenPolicyId() {
        let policyId = Contracts.TreasuryCheckTokenScript.policy_id();
        return policyId;
    }

    caculateRedeemDataHash(redeemerProof, bMintCheck) {

        let redeemProofHash = undefined;
        if (bMintCheck) {
            redeemProofHash = Contracts.MintCheckScript.caculateRedeemDataHash(redeemerProof);
        } else {
            redeemProofHash = Contracts.TreasuryScript.caculateRedeemDataHash(redeemerProof);
        }

        return redeemProofHash;
    }

    deCodeTxRedeemersCbor(txInfo, txUtxos, bMintCheck) {

        let tokenPolicyId = Contracts.TreasuryCheckTokenScript.policy_id();
        if (bMintCheck) {
            tokenPolicyId = Contracts.MintCheckTokenScript.policy_id();
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
                        redeemer = Contracts.MintCheckScript.getRedeemerFromCBOR(redeemerInfo.redeemer);
                    } else {
                        redeemer = Contracts.TreasuryScript.getRedeemerFromCBOR(redeemerInfo.redeemer);
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
        //this.logger.debug("..ContractService...getGroupInfoStkVh...StkVh: ", StkVh);
        return StkVh;
    }

    getGroupPublicKey(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let groupPK = groupInfo[ContractsMgr.GroupNFT.GPK];
        //this.logger.debug("..ContractService...getGroupPublicKey...groupPK: ", groupPK);
        return groupPK;
    }

    getTreasuryCheckVH(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let treasuryCheckVH = groupInfo[ContractsMgr.GroupNFT.TreasuryCheckVH];
        //this.logger.debug("..ContractService...getTreasuryCheckVH...treasuryCheckVH: ", treasuryCheckVH);
        return treasuryCheckVH;
    }


    getTreasuryMintCheckVH(groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let mintCheckVH = groupInfo[ContractsMgr.GroupNFT.MintCheckVH];
        //this.logger.debug("..ContractService...getTreasuryMintCheckVH...mintCheckVH: ", mintCheckVH);
        return mintCheckVH;
    }


    getTreasuryCheckAddress(bMintCheck, groupInfoTokenDatum) {
        if (undefined === groupInfoTokenDatum) {
            return undefined;
        }

        const groupInfo = ContractsMgr.GroupNFT.groupInfoFromDatum(groupInfoTokenDatum);
        let checkStkVh = groupInfo[ContractsMgr.GroupNFT.StkVh];
        // this.logger.debug("..ContractService...getTreasuryCheckAddress...stkVh: ", checkStkVh);

        let vhItemName = bMintCheck ? ContractsMgr.GroupNFT.MintCheckVH : ContractsMgr.GroupNFT.TreasuryCheckVH;
        let checkPayVh = groupInfo[vhItemName];
        // this.logger.debug("..ContractService...getTreasuryCheckAddress...checkPayVh: ", bMintCheck, vhItemName, checkPayVh);

        let checkStkKeyHash = CardanoWasm.ScriptHash.from_hex(checkStkVh); //Ed25519KeyHash
        let checkPayKeyHash = CardanoWasm.ScriptHash.from_hex(checkPayVh);

        let checkAddress = CardanoWasm.BaseAddress.new(
            this.network_id,
            CardanoWasm.Credential.from_scripthash(checkPayKeyHash),
            CardanoWasm.Credential.from_scripthash(checkStkKeyHash) //from_keyhash
        );

        let strCheckAddress = checkAddress.to_address().to_bech32(this.ADDR_PREFIX);
        // this.logger.debug("..ContractService...getTreasuryCheckAddress...strCheckAddress: ", strCheckAddress);
        if (bMintCheck) {
            let mintCheckTokenPolicyId = Contracts.MintCheckTokenScript.policy_id();
            // this.logger.debug("..ContractService...getTreasuryCheckAddress...mintCheckTokenPolicyId: ", mintCheckTokenPolicyId);
        } else {
            let checkTokenPolicyId = Contracts.TreasuryCheckTokenScript.policy_id();
            // this.logger.debug("..ContractService...getTreasuryCheckAddress...checkTokenPolicyId: ", checkTokenPolicyId);
        }
        return strCheckAddress;
    }

    getGroupInfoHolder() {
        const groupInfoHolder = ContractsMgr.GroupInfoNFTHolderScript.address().to_bech32(this.ADDR_PREFIX);
        // this.logger.debug("..ContractService......GroupInfoNFTHolderScript address: ", groupInfoHolder);

        let expectedTokenId = ContractsMgr.GroupNFT.tokenId(); // need liulin confirm
        expectedTokenId = expectedTokenId.replace(".", "");

        let ret = {
            "groupHolder": groupInfoHolder,
            "tokenId": expectedTokenId
        }
        return ret;
    }

    async transferFromTreasury(protocolParams, utxosForFee, utxosToSpend, scriptRefUtxo, groupNFTUtxo, funValue, toAddr, redeemProof,
        utxoForCollateral, treasuryCheckUxto, treasuryCheckRef, changeAddress, evaluateTxFn, signFn, rawMetaData, ttl) {

        try {
            const signedTxOutBound = await Contracts.TreasuryScript.transferFromTreasury(protocolParams, utxosForFee, utxosToSpend,
                scriptRefUtxo, groupNFTUtxo, funValue, toAddr, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef,
                changeAddress, evaluateTxFn, signFn, rawMetaData, ttl);

            this.logger.debug("..PlutusTxBuilder...transferFromTreasury signedTxOutBound finished. ");
            return signedTxOutBound;

        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...transferFromTreasury...buildAndSignRawTx error: ", e);
            throw e;
        }
    }

    async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo,
        redeemProof, changeAddress, evaluateTxFn, signFn, ttl, rawMetaData) {

        try {
            const signedTxOutBound = await Contracts.MappingTokenScript.mint(protocolParams, utxosForFee, utxoForCollateral,
                scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, changeAddress, evaluateTxFn,
                signFn, ttl, rawMetaData);

            this.logger.debug("..PlutusTxBuilder...mint...signedTxOutBound finished. ");
            return signedTxOutBound;
        } catch (e) {
            this.logger.debug("..PlutusTxBuilder...mint error: ", e);
            throw e;
        }
    }

}


module.exports = ContractService;
