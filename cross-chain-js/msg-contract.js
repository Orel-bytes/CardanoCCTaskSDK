const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const jsSHA = require("jssha");
const utils = require('./utils');
const BigNumber = require('bignumber.js');

const plutus = require('./plutus');

const plutusdata = require('./plutusdata');

let Network_Id = 1;
const contractMgr = require('./contracts-mgr');
const cbor = require('cbor-sync');

let inboundTokenScript;
let inboundCheckScript;
let inboundCheckTokenScript;
let outboundTokenScript;
let outboundHolderScript;


const PRD = true;
function getCostModels(protocolParams) {
    if (PRD) {
        return protocolParams.costModels;
    } else {
        return CardanoWasm.TxBuilderConstants.plutus_conway_cost_models();
    }
}
class OutboundHolderScript {
    static script() {
        return outboundHolderScript;
    }

    static address(stake_cred = undefined) {

        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(OutboundHolderScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(OutboundHolderScript.script().hash())).to_address();
        }
    }
}

class InboundTokenScript {

    constructor(scriptCbor) {
    }

    // static tokenName = 'InboundTokenCoin';

    static script() {
        return inboundTokenScript;
    }

    static policy_id() {
        return inboundTokenScript.hash().to_hex();
    }

    static tokenId(tokeNameHex) {
        return this.policy_id() + '.' + Buffer.from(tokeNameHex, 'hex').toString('hex');
    }

    static async burn(protocolParams, utxosForFee, utxoForCollateral, scriptRef, utxosToBurn, burnValue, changeAddress, evaluateFn, signFn, ttl) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        let totalScriptSize = 0;

        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            // totalInputValue = totalInputValue.checked_add(value);
            txBuilder.add_regular_input(from, input, value);
        }

        for (let i = 0; i < utxosToBurn.length; i++) {
            const utxoBurn = utxosToBurn[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoBurn.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoBurn.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoBurn.value);
            const from = CardanoWasm.Address.from_bech32(utxoBurn.address);
            // totalInputValue = totalInputValue.checked_add(value);
            txBuilder.add_regular_input(from, input, value);
        }

        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );

        const burnValueCrosschain = utils.funValue(burnValue);
        // if (burnValueCrosschain.multiasset().len() != 1) throw 'bad burn value:' + JSON.stringify(burnValue);

        const policyToBurn = burnValueCrosschain.multiasset().keys().get(0);

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);
        totalScriptSize += scriptSize;

        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(
            policyToBurn
            , scriptRefInput, scriptTmp.language_version(), scriptSize);

        const exUnitsMint = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((2166688) + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str((589206509) + '')//(EX_UNIT_B)306405352
        );

        const mintRedeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
            exUnitsMint
        );
        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(mint_plutus_script_source, mintRedeemer);

        for (const tokenId in burnValue.assets) {

            const [policy_id, tokenName] = tokenId.split('.');
            const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
            const burnedAmount = burnValue.assets[tokenId];
            mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('-' + burnedAmount));
        }

        let collaterOwnerAddress;
        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoCollateral.value + ''));
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            collaterOwnerAddress = from;
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }


        txBuilder.set_mint_builder(mintBuilder);

        // if (rawMetaData) {
        //     txBuilder.set_auxiliary_data(InboundTokenScript.genMetaData(rawMetaData));
        // }
        if (ttl) {
            txBuilder.set_ttl(ttl);
        }

        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);
        txBuilder.set_collateral(txCollateralInputBuilder);
        // console.log('min_fee:', txBuilder.min_fee().to_str());
        txBuilder.set_total_collateral_and_return(txBuilder.min_fee().checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));

        let tx = txBuilder.build_tx();
        const body = tx.body();

        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);

        // return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
        const draftTx = CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
        // console.log('======', draftTx.to_json());
        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v3(), costModesLib.get(CardanoWasm.Language.new_plutus_v3())); 
        return utils.fixTxExuintByEvaluate(protocolParams, tmp,draftTx.to_hex(), totalScriptSize, evaluateFn, signFn);
    }
    //redeemProof = {
    // proof:{
    //      crossMsgdata:{taskId:'',sourceChainId:1,sourceContract:'',targetChainId:'',targetContract:'',functionCallData:{functionName:'',functionArgs:''}}
    //      ,nonce:{txHash:'',index:''}
    //      ,ttl:''
    //      ,mode:''}
    // ,signature: ''}
    
    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, changeAddress, evaluateFn, signFn, ttl) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        let totalScriptSize = 0;

        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            // totalInputValue = totalInputValue.checked_add(value);
            txBuilder.add_regular_input(from, input, value);
        }

        const { script: InboundTokenScriptFromCBor, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);
        totalScriptSize += scriptSize;
        const scriptHash = InboundTokenScriptFromCBor.hash();
        // console.log('scriptHash:',scriptHash.to_hex());
        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );

        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(scriptHash
            , scriptRefInput, InboundTokenScriptFromCBor.language_version(), scriptSize);

        const exUnitsMint = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((2536910) + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str((664469356) + '')//(EX_UNIT_B)306405352
        );

        const mintRedeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
            exUnitsMint
        );
        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(mint_plutus_script_source, mintRedeemer);

        const policy_id = redeemProof.policy_id;

        const tokenName = utils.addressToPkhOrScriptHash(redeemProof.proofData.crossMsgData.targetContract);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('1'));

        //step1: construct reference input
        const groupNFTRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(groupNFTUtxo.txHash), groupNFTUtxo.index);
        const mintCheckRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(mintCheckScriptRef.txHash), mintCheckScriptRef.index);
        const mintCheckInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(mintCheckUtxo.txHash), mintCheckUtxo.index);

        const mintCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(mintCheckUtxo.address));

        const { script: scriptTmp2, scriptSize: scriptSize2 } = utils.plutusScriptFromScriptRef(mintCheckScriptRef);
        totalScriptSize += scriptSize2;

        const mint_check_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(mintCheckScriptHash, mintCheckRefInput
            , scriptTmp2.language_version(), scriptSize2);
        const exUnitsSpendMintCheck = CardanoWasm.ExUnits.new(CardanoWasm.BigNum.from_str((4433118) + ''), CardanoWasm.BigNum.from_str((1416265282) + ''));
        const redeemerData = InboundCheckScript.genMsgCrossRedeemer(redeemProof);
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_spend(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnitsSpendMintCheck
        );
        const mintCheckWitness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(mint_check_plutus_script_source, redeemer)



        let collaterOwnerAddress;
        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoCollateral.value + ''));
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            collaterOwnerAddress = from;
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }

        {
            const toAddr = CardanoWasm.Address.from_bech32(redeemProof.proofData.crossMsgData.targetContract);
            let crossMsgDatum = plutusdata.toPlutusDataCrossMsgData(redeemProof.proofData.crossMsgData);
            const mutiAsset = CardanoWasm.MultiAsset.new();
            const asset = CardanoWasm.Assets.new();
            asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
            mutiAsset.insert(scriptHash, asset);
            
            const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [InboundTokenScript.tokenId(tokenName)]: 1 } }, crossMsgDatum);
            let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
            mintedValue.set_multiasset(mutiAsset);
            const outputOfInboundToken = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);
            outputOfInboundToken.set_plutus_data(crossMsgDatum);
            txBuilder.add_output(outputOfInboundToken);
        }

        const mintCheckUtxovalue = utils.funValue(mintCheckUtxo.value);
        const mintcheckAddress = CardanoWasm.Address.from_bech32(mintCheckUtxo.address);
        const minAdaOfMintCheckChangeUtxo = utils.getMinAdaOfUtxo(protocolParams, mintcheckAddress, mintCheckUtxovalue, utils.genDemoDatum42());
        const checkTokenAssetName = CardanoWasm.AssetName.new(Buffer.from(InboundCheckTokenScript.tokenName()));
        const multiAssetOfCheckToken = CardanoWasm.MultiAsset.new();
        const mintCheckTokenAsset = CardanoWasm.Assets.new();
        mintCheckTokenAsset.insert(checkTokenAssetName, CardanoWasm.BigNum.from_str('1'));
        multiAssetOfCheckToken.insert(InboundCheckTokenScript.script().hash(), mintCheckTokenAsset) //(checkTokenAssetName,CardanoWasm.Int.from_str('1'));
        const outputMintCheckChange = CardanoWasm.TransactionOutput.new(
            mintcheckAddress,
            CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaOfMintCheckChangeUtxo), multiAssetOfCheckToken));
        outputMintCheckChange.set_plutus_data(utils.genDemoDatum42());



        txBuilder.set_mint_builder(mintBuilder);
        txBuilder.add_reference_input(groupNFTRefInput);
        txBuilder.add_plutus_script_input(mintCheckWitness, mintCheckInput, utils.funValue(mintCheckUtxo.value));
        txBuilder.add_output(outputMintCheckChange);

        // if (rawMetaData) {
        //     txBuilder.set_auxiliary_data(NFTMappingTokenScript.genMetaData(rawMetaData));
        // }
        if (ttl) {
            txBuilder.set_ttl(ttl);
        }

        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);
        txBuilder.set_collateral(txCollateralInputBuilder);
        // console.log('min_fee:', txBuilder.min_fee().to_str());
        txBuilder.set_total_collateral_and_return(txBuilder.min_fee().checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));

        let tx = txBuilder.build_tx();
        const body = tx.body();
        // console.log('real_fee:', body.fee().to_str());
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);

        // return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());

        const draftTx = CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
        //console.log('======', draftTx.to_json());
        //console.log(draftTx.to_hex());
        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v3(), costModesLib.get(CardanoWasm.Language.new_plutus_v3())); 
        return utils.fixTxExuintByEvaluate(protocolParams, tmp,draftTx.to_hex(), totalScriptSize, evaluateFn, signFn);
        // return draftTx;
    }

}

class InboundCheckScript {
    // constructor(scriptCbor) {
    //     this.nftTreasuryCheckScript = CardanoWasm.PlutusScript.from_bytes_v3(Buffer.from(scriptCbor, 'hex'));
    // }

    static script() {
        return inboundCheckScript;
    }

    static address(stake_cred = undefined) {
        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(InboundCheckScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(InboundCheckScript.script().hash())).to_address();
        }
    }

    static __proofData(proof) {
        const ls = CardanoWasm.PlutusList.new();

        ls.add(plutusdata.toPlutusDataCrossMsgData(proof.crossMsgData));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.ttl + '')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.mode + '')));
        ls.add(plutusdata.toPlutusDataOutputReference_aiken(proof.nonce.txHash, proof.nonce.index));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }

    static caculateRedeemDataHash(proof) {

        const rawData = this.__proofData(proof).to_hex();
        const shaObj = new jsSHA("SHA3-256", "UINT8ARRAY"/*,{encoding:"UTF8"}*/)
        shaObj.update(Buffer.from(rawData, 'hex'));
        const dataHash = shaObj.getHash("HEX");

        return dataHash;
    }

    static getCrossRedeemerFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);

        const alternative = redeemer.as_constr_plutus_data().alternative().to_str();
        switch (alternative) {
            case '0': {
                // throw 'bad cross redeemer data';
                break;
            }
            case '1': {
                return this.__getMsgCrossProofFromCBOR(redeemerHex);
                break;
            }
            case '2': {
                throw 'bad cross redeemer data';
            }
            default:
                throw 'bad cross redeemer data';
        }

    }

    static __getMsgCrossProofFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const wrappedLs = redeemer.as_constr_plutus_data().data();
        const ls = wrappedLs.get(0).as_constr_plutus_data().data();
        // console.log('len: ',ls.len(),);


        const signature = Buffer.from(ls.get(1).as_bytes()).toString('hex');
        const proofCbor = ls.get(0).as_constr_plutus_data().data();

        const inboundDataCbor = proofCbor.get(0).as_constr_plutus_data().to_hex();
        const crossMsgData = plutusdata.crossMsgDataFromCbor(inboundDataCbor, Network_Id);
        const ttl = proofCbor.get(1).as_integer().as_int().as_i32();
        const mode = proofCbor.get(2).as_integer().as_int().as_i32();

        const { txHash, index } = plutusdata.OutputReference_aikenFromCbor(proofCbor.get(3).as_constr_plutus_data().to_hex());

        return { proof: { crossMsgData, mode, ttl, nonce: { txHash, index } }, signature };
    }

    static genBurnRedeemerData() {
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                CardanoWasm.PlutusList.new()
            )
        )
    }

    static __genInboundCheckProof(proof) {
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.__proofData(proof.proofData));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }

    static genMsgCrossRedeemer(proof) {
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.__genInboundCheckProof(proof));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('1'),
                ls
            )
        )
    }

    static async burn(protocolParams, utxosForFee, utxoForCollateral, utxosSpend, scriptRef, checkTokenScriptRef, groupInfoUtxo, adminNftInfo, changeAddress, signFn, exUnitTx) {
        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            inputs_arr.push(utxosForFee[i].txHash + '#' + utxosForFee[i].index);
        }
        for (let i = 0; i < utxosSpend.length; i++) {
            const utxoSpend = utxosSpend[i];
            inputs_arr.push(utxoSpend.txHash + '#' + utxoSpend.index);
        }
        inputs_arr.push(adminNftInfo.adminNftUtxo.txHash + '#' + adminNftInfo.adminNftUtxo.index);
        inputs_arr.sort();

        const txBuilder = utils.initTxBuilder(protocolParams);

        const scriptRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(scriptRef.txHash, 'hex')), scriptRef.index);
        const groupInfoTokenInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(groupInfoUtxo.txHash), groupInfoUtxo.index);
        const checkTokenScriptRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(checkTokenScriptRef.txHash, 'hex')), checkTokenScriptRef.index);

        txBuilder.add_reference_input(groupInfoTokenInput);

        const mintBuilder = CardanoWasm.MintBuilder.new();
        let exUnitsMint = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((3971680) + ''),
            CardanoWasm.BigNum.from_str((1160384164) + '')
        );
        if (exUnitTx) {
            exUnitsMint = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((exUnitTx['mint:0'].memory) + ''),
                CardanoWasm.BigNum.from_str((exUnitTx['mint:0'].steps) + '')
            );
        }

        const redeemerData = this.genBurnRedeemerData();//CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnitsMint
        );

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(checkTokenScriptRef);

        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(
            CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash(), checkTokenScriptRefInput
                , scriptTmp.language_version(), scriptSize)
            , redeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(InboundTokenScript.tokenName()));
        // console.log(assetName.to_json());
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('-' + utxosSpend.length));
        txBuilder.set_mint_builder(mintBuilder);


        let totalInputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            totalInputValue = totalInputValue.checked_add(value);
            // txBuilder.add_regular_input(from, input, value);
            txInputBuilder.add_regular_input(from, input, value);
        }

        for (let i = 0; i < utxosSpend.length; i++) {
            const utxo = utxosSpend[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxo.index);
            const value = utils.funValue(utxo.value);
            // const from = CardanoWasm.Address.from_bech32(utxoForFee.address);

            let exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((5216614) + ''),
                CardanoWasm.BigNum.from_str((1880092692) + '')
            );
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxo.txHash + '#' + utxo.index);
                exUnits = CardanoWasm.ExUnits.new(
                    CardanoWasm.BigNum.from_str(exUnitTx['spend:' + index].memory + ''),
                    CardanoWasm.BigNum.from_str(exUnitTx['spend:' + index].steps + '')
                );
            }

            const redeemerData = this.genBurnRedeemerData();

            const redeemer = CardanoWasm.Redeemer.new(CardanoWasm.RedeemerTag.new_spend(), CardanoWasm.BigNum.from_str('0'), redeemerData, exUnits);

            const scriptHash = utils.addressToPkhOrScriptHash(utxo.address);


            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);

            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(
                CardanoWasm.PlutusScriptSource.new_ref_input(
                    CardanoWasm.ScriptHash.from_hex(scriptHash), scriptRefInput, scriptTmp.language_version(), scriptSize)
                , redeemer
            )

            txInputBuilder.add_plutus_script_input(witness, input, value);
        }

        let exUintEVA;
        if (exUnitTx) {
            const index = inputs_arr.indexOf(adminNftInfo.adminNftUtxo.txHash + '#' + adminNftInfo.adminNftUtxo.index);
            exUintEVA = exUnitTx['spend:' + index];
        }
        contractMgr.AdminNFTHolderScript.usingAdminNft(protocolParams, txBuilder, txInputBuilder, adminNftInfo.adminNftUtxo, adminNftInfo.adminNftHoldRefScript, adminNftInfo.mustSignBy, exUintEVA);
        txBuilder.set_inputs(txInputBuilder);
        // console.log(txBuilder.get_total_input().to_json());

        let collaterOwnerAddress;
        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            collaterOwnerAddress = from;
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);
        txBuilder.set_collateral(txCollateralInputBuilder);
        txBuilder.set_total_collateral_and_return(txBuilder.min_fee().checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));

        let tx = txBuilder.build_tx();
        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());

        if (signFn) {
            const body = tx.body();
            const txHash = CardanoWasm.hash_transaction(body);
            const signResult = await signFn(txHash.to_hex());
            const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
            const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
            vkeyWitnesses.add(vkeyWitness);
            witnessSet.set_vkeys(vkeyWitnesses);
        }

        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }


}

class OutboundTokenScript {

    constructor(scriptCbor) {
    }
    static tokenName = 'OutboundTokenCoin'
    static script() {
        return outboundTokenScript;
    }

    static policy_id() {
        return outboundTokenScript.hash().to_hex();
    }

    static tokenId() {
        return this.policy_id() + '.' + Buffer.from(OutboundTokenScript.tokenName, 'ascii').toString('hex');
    }

    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, groupNFTUtxo, outboundData, callBackFn, changeAddress, evaluateFn, signFn, ttl) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        let totalScriptSize = 0;

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            // totalInputValue = totalInputValue.checked_add(value);
            // txBuilder.add_regular_input(from, input, value);
            txInputBuilder.add_regular_input(from, input, value);
        }
        if(callBackFn) await callBackFn(txInputBuilder);

        const { script: outboundTokenScriptFromCBor, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);
        totalScriptSize += scriptSize;
        const scriptHash = outboundTokenScriptFromCBor.hash();
        // console.log('scriptHash:',scriptHash.to_hex());
        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );

        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(scriptHash
            , scriptRefInput, outboundTokenScriptFromCBor.language_version(), scriptSize);

        const exUnitsMint = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((2536910) + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str((664469356) + '')//(EX_UNIT_B)306405352
        );

        const outboundDatum = plutusdata.toPlutusDataCrossMsgData(outboundData);
        const mintRedeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
            exUnitsMint
        );
        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(mint_plutus_script_source, mintRedeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(OutboundTokenScript.tokenName, 'ascii'));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('1'));


        let collaterOwnerAddress;
        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoCollateral.value + ''));
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            collaterOwnerAddress = from;
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }

        const groupInfo = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);

        const outboundTokenHolderAddress = CardanoWasm.EnterpriseAddress.new(
            Network_Id
            , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(groupInfo[contractMgr.GroupNFT.OutboundHolderVH]))
            // , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(groupInfo[contractMgr.GroupNFT.StkVh]))
        ).to_address();
        const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, outboundTokenHolderAddress, { coins: 1000000, assets: { [OutboundTokenScript.tokenId()]: 1 } }, outboundDatum);
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
        mintedValue.set_multiasset(mutiAsset);
        const outputOfOutboundToken = CardanoWasm.TransactionOutput.new(outboundTokenHolderAddress, mintedValue);
        outputOfOutboundToken.set_plutus_data(outboundDatum);
        txBuilder.add_output(outputOfOutboundToken);

        txBuilder.set_inputs(txInputBuilder);
        txBuilder.set_mint_builder(mintBuilder);
        const groupNFTRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(groupNFTUtxo.txHash), groupNFTUtxo.index);
        txBuilder.add_reference_input(groupNFTRefInput);

        if (ttl) {
            txBuilder.set_ttl(ttl);
        }

        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);
        txBuilder.set_collateral(txCollateralInputBuilder);
        // console.log('min_fee:', txBuilder.min_fee().to_str());
        txBuilder.set_total_collateral_and_return(txBuilder.min_fee().checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));

        let tx = txBuilder.build_tx();
        const body = tx.body();
        // console.log('real_fee:', body.fee().to_str());
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);


        const draftTx = CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
        //console.log('======', draftTx.to_json());
        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v3(), costModesLib.get(CardanoWasm.Language.new_plutus_v3())); 
        return utils.fixTxExuintByEvaluate(protocolParams, tmp,draftTx.to_hex(), totalScriptSize, evaluateFn, signFn);
        // return draftTx;
    }

}

class CheckTokenScriptBase {

    static script() {
        // return checkTokenScript;
        throw 'not supports'
    }

    static policy_id() {
        return this.script().hash().to_hex();
    }

    static tokenName() {
        throw "not supports";
    }

    static tokenId() {
        return this.policy_id() + '.' + Buffer.from(this.tokenName()).toString('hex');
    }

    static genTreasuryNFTDatum(token_id) {
        let [policy_id, tokenName] = ['', ''];
        if (token_id != '') {
            [policy_id, tokenName] = token_id.split('.');
        }

        const ls = CardanoWasm.PlutusList.new();
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(policy_id, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(tokenName, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }


    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, groupInfoUtxo, adminNftInfo, changeAddress, mintAmount, mintTo, signFn, exUnitTx) {

        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            inputs_arr.push(utxosForFee[i].txHash + '#' + utxosForFee[i].index);
        }
        inputs_arr.push(adminNftInfo.adminNftUtxo.txHash + '#' + adminNftInfo.adminNftUtxo.index);
        inputs_arr.sort();

        const fee = CardanoWasm.BigNum.from_str('256907');//fake fee value 255499
        const txBuilder = utils.initTxBuilder(protocolParams);

        // const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'));

        const scriptRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(scriptRef.txHash, 'hex')), scriptRef.index);
        const groupInfoTokenInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(groupInfoUtxo.txHash), groupInfoUtxo.index);
        // txBuilder.add_reference_input(scriptRefInput);
        txBuilder.add_reference_input(groupInfoTokenInput);

        const mintBuilder = CardanoWasm.MintBuilder.new();
        let exUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((7090302) + ''),
            CardanoWasm.BigNum.from_str((1860384164) + '')
        );
        if (exUnitTx) {
            exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((exUnitTx['mint:0'].memory) + ''),
                CardanoWasm.BigNum.from_str((exUnitTx['mint:0'].steps) + '')
            );
        }

        const redeemerData = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnits
        );

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);
        //console.log('scriptTmp:', scriptTmp.language_version().to_json(), scriptTmp.hash().to_hex());

        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(
            CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash(), scriptRefInput, scriptTmp.language_version(), scriptSize)
            , redeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(this.tokenName()));
        // console.log(assetName.to_json());
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('' + mintAmount));
        txBuilder.set_mint_builder(mintBuilder);


        let totalInputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            totalInputValue = totalInputValue.checked_add(value);
            // txBuilder.add_regular_input(from, input, value);
            txInputBuilder.add_regular_input(from, input, value);
        }

        const authorityDatum = utils.genDemoDatum42();
        const holderAddr = CardanoWasm.Address.from_bech32(mintTo);//TreasuryCheckScript.address(groupInfo[contractMgr.GroupNFT.StkVh]);
        const tokenId = this.tokenId();
        const minAdaWithToken = utils.getMinAdaOfUtxo(protocolParams, holderAddr, { coins: 1000000, assets: { [tokenId]: 1 } }, authorityDatum);
        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithToken));
        const scriptHash = this.script().hash();
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);
        mintedValue.set_multiasset(mutiAsset);
        const output = CardanoWasm.TransactionOutput.new(holderAddr, mintedValue);
        output.set_plutus_data(authorityDatum);
        for (let i = 0; i < mintAmount; i++) {
            txBuilder.add_output(output);
        }


        // const groupInfo = contractMgr.GroupNFT.groupInfoFromDatum(groupInfoUtxo.datum);
        // const signer = CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.Admin]);
        // txBuilder.add_required_signer(signer);
        let exUintEVA;
        if (exUnitTx) {
            const index = inputs_arr.indexOf(adminNftInfo.adminNftUtxo.txHash + '#' + adminNftInfo.adminNftUtxo.index);
            exUintEVA = exUnitTx['spend:' + index];
        }
        contractMgr.AdminNFTHolderScript.usingAdminNft(protocolParams, txBuilder, txInputBuilder, adminNftInfo.adminNftUtxo, adminNftInfo.adminNftHoldRefScript, adminNftInfo.mustSignBy, exUintEVA);
        txBuilder.set_inputs(txInputBuilder);
        // console.log(txBuilder.get_total_input().to_json());
        // if (ttl) {
        //     txBuilder.set_ttl(ttl);
        // }

        // if (rawMetaData) {
        //     txBuilder.set_auxiliary_data(rawMetaData);
        // }

        let collaterOwnerAddress;
        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            collaterOwnerAddress = from;
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);
        txBuilder.set_collateral(txCollateralInputBuilder);
        txBuilder.set_total_collateral_and_return(txBuilder.min_fee().checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));

        let tx = txBuilder.build_tx();

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        if (signFn) {
            const body = tx.body();
            const txHash = CardanoWasm.hash_transaction(body);
            const signResult = await signFn(txHash.to_hex());
            const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
            const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
            vkeyWitnesses.add(vkeyWitness);
            witnessSet.set_vkeys(vkeyWitnesses);
        }


        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }

}

class InboundCheckTokenScript extends CheckTokenScriptBase {
    static script() {
        return inboundCheckTokenScript;
    }

    static tokenName() {
        return 'InboundCheckCoin';
    }
}



function init(network = true) {

    const currentPlutus = network ? plutus.mainnet : plutus.testnet;
    Network_Id = network ? 1 : 0;

    const inboundTokenPlutus = currentPlutus.inboundTokenPlutus;
    const inboundCheckPlutus = currentPlutus.inboundCheckPlutus;
    const inboundCheckTokenPlutus = currentPlutus.inboundCheckTokenPlutus;
    const outboundTokenPlutus = currentPlutus.outboundTokenPlutus;
    const outboundHolderPlutus = currentPlutus.outboundHolderPlutus;
    inboundTokenScript = utils.plutusScriptFromPlutusObj(inboundTokenPlutus);
    inboundCheckScript = utils.plutusScriptFromPlutusObj(inboundCheckPlutus);
    inboundCheckTokenScript = utils.plutusScriptFromPlutusObj(inboundCheckTokenPlutus);
    outboundTokenScript = utils.plutusScriptFromPlutusObj(outboundTokenPlutus);
    outboundHolderScript = utils.plutusScriptFromPlutusObj(outboundHolderPlutus);
}



module.exports = {
    init
    , OutboundHolderScript
    , InboundCheckScript
    , OutboundTokenScript
    , InboundCheckTokenScript
    , InboundTokenScript
}