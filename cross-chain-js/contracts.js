const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const jsSHA = require("jssha");
const utils = require('./utils');
const BigNumber = require('bignumber.js');

const plutus = require('./plutus');
const cbor = require('cbor-sync');

const contractMgr = require('./contracts-mgr');
const nftContracts = require('./nft-contract');
const msgContracts = require('./msg-contract');
let MAPPINGTOKEN_POLICY;
// let groupInfoTokenPlutus;
// let groupInfoTokenHolderPlutus;
// let treasuryPlutus;
// let treasuryCheckPlutus;
// let mappingTokenPlutus;
// let mintCheckPlutus;


let treasuryScript;// = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(treasuryPlutus.cborHex, 'hex'));
let treasuryCheckScript;// = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(treasuryCheckPlutus.cborHex, 'hex'));
let mappingTokenScript;// = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(mappingTokenPlutus.cborHex, 'hex'));
let mintCheckScript;// = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(mintCheckPlutus.cborHex, 'hex'));
// let checkTokenScript;
let treasuryCheckTokenScript;
let mintCheckTokenScript;

// const GroupInfoTokenName = 'GroupInfoTokenCoin';
// const CheckTokenName = 'CheckTokenCoin';

const PRD = true;
function getCostModels(protocolParams) {
    if (PRD) {
        return protocolParams.costModels;
        // return CardanoWasm.TxBuilderConstants.plutus_conway_cost_models();//protocolParams.costModels;
    } else {
        return CardanoWasm.TxBuilderConstants.plutus_conway_cost_models();
    }
}

class TreasuryCheckScript {
    static script() {
        return treasuryCheckScript;
    }

    static address(stake_cred = undefined) {
        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(TreasuryCheckScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(TreasuryCheckScript.script().hash())).to_address();
        }
    }

    // static genProofData(redeemerProof) {

    //     const ls = CardanoWasm.PlutusList.new();

    //     let toAddrr = CardanoWasm.Address.from_bech32(redeemerProof.to);

    //     let valueObj = utils.funValue({ coins: redeemerProof.adaAmount, assets: { [redeemerProof.tokenId]: redeemerProof.amount } });

    //     const input = CardanoWasm.TransactionInput.new(
    //         CardanoWasm.TransactionHash.from_hex(redeemerProof.txHash)
    //         , redeemerProof.index
    //     )
    //     console.log(toAddrr.to_hex());
    //     console.log(toAddrr.to_json());
    //     ls.add(CardanoWasm.PlutusData.from_hex(toAddrr.to_hex()));
    //     ls.add(CardanoWasm.PlutusData.from_hex(valueObj.to_hex()));
    //     ls.add(CardanoWasm.PlutusData.from_hex(input.to_hex()));

    //     ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemerProof.mode + '')));
    //     ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(redeemerProof.uniqueId, 'hex')));

    //     ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemerProof.txType + '')));

    //     ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemerProof.ttl + '')));
    //     ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemerProof.toIndex + '')));

    //     {
    //         let indexs = CardanoWasm.PlutusList.new();
    //         for (let i = 0; i < redeemerProof.changeIndexs.length; i++) {
    //             indexs.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemerProof.changeIndexs[i] + '')));
    //         }
    //         ls.add(CardanoWasm.PlutusData.new_list(indexs));
    //     }

    //     ls.add(CardanoWasm.PlutusData.from_hex(redeemerProof.userData));


    //     return CardanoWasm.PlutusData.new_constr_plutus_data(
    //         CardanoWasm.ConstrPlutusData.new(
    //             CardanoWasm.BigNum.from_str('0'),
    //             ls
    //         )
    //     );
    // }

    // static caculateRedeemDataHash(redeemerProof) {
    //     const data = this.genProofData(redeemerProof);

    //     const shaObj = new jsSHA("SHA3-256", "UINT8ARRAY"/*,{encoding:"UTF8"}*/)
    //     shaObj.update(Buffer.from(data.to_hex(), 'hex'));
    //     const dataHash = shaObj.getHash("HEX");
    //     return dataHash;
    // }

    static genRedeemerData(redeemProof) {
        const ls = CardanoWasm.PlutusList.new();

        ls.add(this.genProofData(redeemProof));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(redeemProof.signature, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        );
    }

    static genBurnRedeemerData() {//{"constructor":0,"fields":[]}
        // const ls = CardanoWasm.PlutusList.new();
        // return CardanoWasm.PlutusData.new_constr_plutus_data(
        //     CardanoWasm.ConstrPlutusData.new(
        //         CardanoWasm.BigNum.from_str('0'),
        //         ls
        //     )
        // )

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                CardanoWasm.PlutusList.new()
            )
        )
    }
    static async test(protocolParams, utxosForFee, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef, changeAddress, signFn) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
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
        txBuilder.set_collateral(txCollateralInputBuilder);

        const spendInputs = CardanoWasm.TxInputsBuilder.new();

        const redeemerData = TreasuryScript.redeemProof(redeemProof);//(toAddr, funValueMap, utxosForFee[0]);
        // console.log('redeemer:', redeemerData.to_json());

        const authorityCheckRefenceInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(treasuryCheckRef.txHash), treasuryCheckRef.index);


        inputs_arr.sort();
        let total_ex_mem = 0;
        let total_ex_cpu = 0;

        const treasuryCheckAddress = CardanoWasm.Address.from_bech32(treasuryCheckUxto.address);
        const treasuryCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(treasuryCheckUxto.address));
        {
            const utxoToSpend = treasuryCheckUxto;

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);

            let ex_unit_mem = 813968;//  4142333
            let ex_unit_cpu = 482846811;// 1447050275

            // console.log('mem:', ex_unit_mem, 'cpu:', ex_unit_cpu);
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((ex_unit_mem) + ''),
                CardanoWasm.BigNum.from_str((ex_unit_cpu) + '')
            );
            total_ex_mem += ex_unit_mem;
            total_ex_cpu += ex_unit_cpu;

            const redeemer = CardanoWasm.Redeemer.new(CardanoWasm.RedeemerTag.new_spend(), CardanoWasm.BigNum.from_str('0'), redeemerData, exUnits);


            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(treasuryCheckRef);

            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(CardanoWasm.PlutusScriptSource.new_ref_input(
                treasuryCheckScriptHash, authorityCheckRefenceInput, scriptTmp.language_version(), scriptSize)
                , redeemer);

            txInputBuilder.add_plutus_script_input(witness, input, value);

            const valueOutputOfTreasuryCheckScript = utils.funValue(treasuryCheckUxto.value);
            // console.log('====<', valueOutputOfTreasuryCheckScript.to_json());
            const minAda = utils.getMinAdaOfUtxo(protocolParams, treasuryCheckAddress, valueOutputOfTreasuryCheckScript, datum42);
            if (valueOutputOfTreasuryCheckScript.coin().less_than(CardanoWasm.BigNum.from_str('' + minAda))) {
                valueOutputOfTreasuryCheckScript.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
            }

            const treasuryCheckOutput = CardanoWasm.TransactionOutput.new(treasuryCheckAddress, valueOutputOfTreasuryCheckScript);
            treasuryCheckOutput.set_plutus_data(datum42);
            txBuilder.add_output(treasuryCheckOutput);

        }

        txBuilder.set_inputs(txInputBuilder);


        // txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(adminpkhash));

        // const costModesLib = CardanoWasm.TxBuilderConstants.plutus_vasil_cost_models();
        // const costModesLib = protocolParams.costModels;
        const costModesLib = getCostModels(protocolParams);//badf62fa873deb5b8f423159136cff579066f43e6276f2fb33bede7ac1ef09f9
        txBuilder.calc_script_data_hash(costModesLib);

        // txBuilder.set_script_data_hash(CardanoWasm.ScriptDataHash.from_hex('2d6310830f281dcc368c424dfb93bac0cf60815c97da98525371766522365355'));

        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        // const redeemers = CardanoWasm.Redeemers.new();
        // redeemers.add(redeemer);
        // const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // txBuilder.set_script_data_hash(hash);



        // txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.BalanceWorker]));

        const minFee = txBuilder.min_fee();
        // console.log('minFee:', minFee.to_str());
        txBuilder.set_total_collateral_and_return(minFee.checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        if (rawMetaData) {
            // txBuilder.set_auxiliary_data(rawMetaData);
            TreasuryScript.setMetaData(txBuilder, rawMetaData);
        }
        if (ttl && redeemProof.ttl >= ttl) {
            txBuilder.set_ttl(ttl);
        } else {
            throw `bad ttl: ${ttl}`
        }


        // txBuilder.add_json_metadatum(CardanoWasm.BigNum.from_str('0'),JSON.stringify(metaData));
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));


        let tx = txBuilder.build_tx();
        // console.log('script data hash:',tx.body().script_data_hash().to_hex());
        // console.log('body:',tx.to_json())

        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);

        // console.log('script data hash:', body.script_data_hash().to_hex())
        // console.log('real Fee:', tx.body().fee().to_str());
        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
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
            CardanoWasm.BigNum.from_str((4038856) + ''),
            CardanoWasm.BigNum.from_str((1100661710) + '')
        );
        if (exUnitTx) {
            exUnitsMint = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((exUnitTx['mint:0'].memory) + ''),
                CardanoWasm.BigNum.from_str((exUnitTx['mint:0'].steps) + '')
            );
        }

        const redeemerData = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnitsMint
        );

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(checkTokenScriptRef);

        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(
            CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash(), checkTokenScriptRefInput, scriptTmp.language_version(), scriptSize)
            , redeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(TreasuryCheckTokenScript.tokenName()));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('-' + (utxosSpend.length)));
        txBuilder.set_mint_builder(mintBuilder);


        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            // totalInputValue = totalInputValue.checked_add(value);
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
                CardanoWasm.BigNum.from_str((5293530) + ''),
                CardanoWasm.BigNum.from_str((1772505374) + '')
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
                CardanoWasm.PlutusScriptSource.new_ref_input(CardanoWasm.ScriptHash.from_hex(scriptHash), scriptRefInput, scriptTmp.language_version(), scriptSize)
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


class TreasuryScript {

    static MODE_ECDSA = 0;
    static MODE_SCHNORR340 = 1;
    static MODE_ED25519 = 2;

    static CROSSTX = 0;
    static BALANCETX = 1;
    static MANUALTX = 2;

    static script() {
        return treasuryScript;
    }

    static address(stake_cred = undefined) {

        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(TreasuryScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(TreasuryScript.script().hash())).to_address();
        }
    }

    // static full_address(network_id = 0,stake_cred){
    //     // const stake_cred = ''
    //     return CardanoWasm.BaseAddress.new(network_id
    //         , CardanoWasm.Credential.from_scripthash(treasuryScript.hash())
    //         , stake_cred).to_address();
    // }

    static async sendFunToTreasury(protocolParams, utxtos, funValue, changeAddress, signFn, rawMetaData, groupInfo, outputCount = 1) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxtos.length; i++) {
            const utxoForFee = utxtos[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            // console.log(value.to_json());
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
        }

        let perValue = { coins: funValue.coins / outputCount, assets: {} };
        const perValueOfOutput = utils.funValue(perValue);
        const multiAsset = CardanoWasm.MultiAsset.new();
        for (const tokenId in funValue.assets) {
            const [policy_id, tokenName] = tokenId.split('.');
            const assets = CardanoWasm.Assets.new();
            assets.insert(CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex')), CardanoWasm.BigNum.from_str('' + funValue.assets[tokenId] / outputCount));
            multiAsset.insert(CardanoWasm.ScriptHash.from_hex(policy_id), assets)
            // perValueOfOutput.assets[tokenId] = funValue.assets[tokenId]/outputCount;
            perValueOfOutput.set_multiasset(multiAsset);
        }


        const minada = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), perValueOfOutput, utils.genDemoDatum42());
        if (perValueOfOutput.coin().to_str() * 1 < minada) {
            perValueOfOutput.set_coin(CardanoWasm.BigNum.from_str('' + minada));
        }
        for (let i = 0; i < outputCount; i++) {
            const output = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), perValueOfOutput);
            let datum = utils.genDemoDatum42();
            output.set_plutus_data(datum);
            txBuilder.add_output(output);
        }
        // const output = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), utils.funValue(funValue));
        // let datum = utils.genDemoDatum42();
        // // output.set_data_hash(CardanoWasm.hash_plutus_data(datum));
        // output.set_plutus_data(datum);
        // console.log(output.to_json());

        txBuilder.set_inputs(txInputBuilder);


        // txBuilder.add_json_metadatum()
        // CardanoWasm.MetadataJsonSchema.
        if (rawMetaData) {
            // txBuilder.set_auxiliary_data(rawMetaData);
            TreasuryScript.setMetaData(txBuilder, rawMetaData);
        }
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));

        // console.log(txInputBuilder.total_value().to_json(), txBuilder.get_explicit_output().to_json());

        const tx = txBuilder.build_tx();
        const body = tx.body();
        let txBodyHash = CardanoWasm.hash_transaction(body);

        const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();
        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const signResult = await signFn(txBodyHash.to_hex());
        vkeyWitnesses.add(CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult)));
        transactionWitnessSet.set_vkeys(vkeyWitnesses);

        const signedTx = CardanoWasm.Transaction.new(
            body,
            transactionWitnessSet,
            tx.auxiliary_data()
        );

        return signedTx;
    }
    static caculateRedeemDataHash(redeemData) {
        // Builds CBOR-serialized ConstrPlutusData with 14 fields matching
        // TreasuryCheckHashData in types.ak / TreasuryCheckProofHashData in TreasuryCheck.hs.
        // This replaces the old hex-string concatenation approach which had no
        // field delimiters and was vulnerable to boundary-ambiguity attacks.

        const { pkhPay, pkhStk } = utils.addressToHashs(redeemData.to);

        let [policy_id, tokenName] = ['', ''];
        if (redeemData.tokenId != '') {
            [policy_id, tokenName] = redeemData.tokenId.split('.');
        }

        const addressType = utils.addressType(redeemData.to);
        let userData = '';
        if (addressType == CardanoWasm.CredKind.Script) {
            if (redeemData.userData === undefined) throw 'userData required in caculateRedeemDataHash()';
            userData = Buffer.from(redeemData.userData, 'hex').toString('hex');//Just check useData don't have prefix '0x'
        }

        // Build PlutusData Constr 0 with 14 fields in canonical order
        const fields = CardanoWasm.PlutusList.new();
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(pkhPay, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(pkhStk ? pkhStk : '', 'hex')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(policy_id, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(tokenName, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.amount + '')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.adaAmount + '')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(redeemData.txHash, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.index + '')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.mode + '')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(redeemData.uniqueId, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.txType + '')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.ttl + '')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.outputCount + '')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(userData, 'hex')));

        const constrData = CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            fields
        );
        const hashCBOR = CardanoWasm.PlutusData.new_constr_plutus_data(constrData).to_hex();

        const shaObj = new jsSHA("SHA3-256", "UINT8ARRAY"/*,{encoding:"UTF8"}*/)
        shaObj.update(Buffer.from(hashCBOR, 'hex'));
        const dataHash = shaObj.getHash("HEX");

        return dataHash;
    }

    static getRedeemerFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const parmsLs = redeemer.as_constr_plutus_data().data()
        const proofHex = parmsLs.get(0).as_constr_plutus_data().to_hex();
        return this.getTreasuryRedeemerFromCBOR(proofHex);
    }

    static getTreasuryRedeemerFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const ls = redeemer.as_constr_plutus_data().data();


        if (ls.len() == 2) {
            const ls = redeemer.as_constr_plutus_data().data()  //.as_constr_plutus_data().data().get(0).as_list();
            const parmsLs = ls.get(0).as_constr_plutus_data().data();
            const userData = Buffer.from(ls.get(1).as_bytes()).toString('hex');

            const toPKHPay = Buffer.from(parmsLs.get(0).as_bytes()).toString('hex');
            const toPKHStk = Buffer.from(parmsLs.get(1).as_bytes()).toString('hex');
            const policy_id = Buffer.from(parmsLs.get(2).as_bytes()).toString('hex');
            const tokenName = Buffer.from(parmsLs.get(3).as_bytes()).toString('hex');
            const tokenId = policy_id === '' ? '' : policy_id + '.' + tokenName;
            const amount = parmsLs.get(4).as_integer().as_int().as_i32();
            const adaAmount = parmsLs.get(5).as_integer().as_int().as_i32();
            const txHash = Buffer.from(parmsLs.get(6).as_bytes()).toString('hex');
            const index = parmsLs.get(7).as_integer().as_int().as_i32();
            const mode = parmsLs.get(8).as_integer().as_int().as_i32();
            const uniqueId = Buffer.from(parmsLs.get(9).as_bytes()).toString('hex');
            const txType = parmsLs.get(10).as_integer().as_int().as_i32();
            const ttl = parmsLs.get(11).as_integer().as_int().as_i32();
            const outputCount = parmsLs.get(12).as_integer().as_int().as_i32();
            const signature = Buffer.from(parmsLs.get(13).as_bytes()).toString('hex');

            return { toPKHPay, toPKHStk, tokenId, adaAmount, amount, txHash, index, mode, uniqueId, txType, ttl, outputCount, userData, signature };
        } else {
            const parmsLs = redeemer.as_constr_plutus_data().data();
            const toPKHPay = Buffer.from(parmsLs.get(0).as_bytes()).toString('hex');
            const toPKHStk = Buffer.from(parmsLs.get(1).as_bytes()).toString('hex');
            const policy_id = Buffer.from(parmsLs.get(2).as_bytes()).toString('hex');
            const tokenName = Buffer.from(parmsLs.get(3).as_bytes()).toString('hex');
            const tokenId = policy_id === '' ? '' : policy_id + '.' + tokenName;
            const amount = parmsLs.get(4).as_integer().as_int().as_i32();
            const adaAmount = parmsLs.get(5).as_integer().as_int().as_i32();
            const txHash = Buffer.from(parmsLs.get(6).as_bytes()).toString('hex');
            const index = parmsLs.get(7).as_integer().as_int().as_i32();
            const mode = parmsLs.get(8).as_integer().as_int().as_i32();
            const uniqueId = Buffer.from(parmsLs.get(9).as_bytes()).toString('hex');
            const txType = parmsLs.get(10).as_integer().as_int().as_i32();
            const ttl = parmsLs.get(11).as_integer().as_int().as_i32();
            const outputCount = parmsLs.get(12).as_integer().as_int().as_i32();
            const signature = Buffer.from(parmsLs.get(13).as_bytes()).toString('hex');

            return { toPKHPay, toPKHStk, tokenId, adaAmount, amount, txHash, index, mode, uniqueId, txType, ttl, outputCount, signature };
        }
    }
    static getTreasuryRedeemerFromCBORSub(redeemerHex) {

        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const parmsLs = redeemer.as_constr_plutus_data().data()  //.as_constr_plutus_data().data().get(0).as_list();

        const toPKHPay = Buffer.from(parmsLs.get(0).as_bytes()).toString('hex');
        const toPKHStk = Buffer.from(parmsLs.get(1).as_bytes()).toString('hex');
        const policy_id = Buffer.from(parmsLs.get(2).as_bytes()).toString('hex');
        const tokenName = Buffer.from(parmsLs.get(3).as_bytes()).toString('hex');
        const tokenId = policy_id === '' ? '' : policy_id + '.' + tokenName;
        const amount = parmsLs.get(4).as_integer().as_int().as_i32();
        const adaAmount = parmsLs.get(5).as_integer().as_int().as_i32();
        const txHash = Buffer.from(parmsLs.get(6).as_bytes()).toString('hex');
        const index = parmsLs.get(7).as_integer().as_int().as_i32();
        const mode = parmsLs.get(8).as_integer().as_int().as_i32();
        const uniqueId = Buffer.from(parmsLs.get(9).as_bytes()).toString('hex');
        const txType = parmsLs.get(10).as_integer().as_int().as_i32();
        const ttl = parmsLs.get(11).as_integer().as_int().as_i32();
        const outputCount = parmsLs.get(12).as_integer().as_int().as_i32();

        if (parmsLs.len() > 13) {
            const userData = Buffer.from(parmsLs.get(13).as_bytes()).toString('hex');
            const signature = Buffer.from(parmsLs.get(14).as_bytes()).toString('hex');

            return { toPKHPay, toPKHStk, tokenId, adaAmount, amount, txHash, index, mode, uniqueId, txType, ttl, outputCount, userData, signature };
        } else {
            const signature = Buffer.from(parmsLs.get(13).as_bytes()).toString('hex');
            return { toPKHPay, toPKHStk, tokenId, adaAmount, amount, txHash, index, mode, uniqueId, txType, ttl, outputCount, signature };
        }


    }

    static treasuryRedeemProof(proof) {
        const ls = CardanoWasm.PlutusList.new();
        // const toPkh = utils.addressToPkhOrScriptHash(proof.to);

        const to = utils.addressToHashs(proof.to);
        let [policy_id, tokenName] = ['', '']
        if (proof.tokenId) [policy_id, tokenName] = proof.tokenId.split('.');

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(to.pkhPay, 'hex')));
        if (to.pkhStk) ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(to.pkhStk, 'hex')));
        else ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from('', 'hex')));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(policy_id, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(tokenName, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.amount + '')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.adaAmount + '')));

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.txHash, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.index + '')));

        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.mode + '')));

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.uniqueId, 'hex')));

        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.txType + '')));

        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.ttl + '')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.outputCount + '')));


        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));



        const addressType = utils.addressType(proof.to);
        //to is is a contract address and not treasury address
        if (addressType == CardanoWasm.CredKind.Script && proof.userData) {
            const lastls = CardanoWasm.PlutusList.new();
            if (proof.userData === undefined) throw 'userData required';
            const proofPart = CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    ls
                )
            )
            lastls.add(proofPart);
            lastls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.userData, 'hex')));
            return CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    lastls
                )
            )
        } else {
            return CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    ls
                )
            )
        }
    }

    static redeemProof(proof) {//{"constructor":0,"fields":[]}
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.treasuryRedeemProof(proof))

        let action = '1';
        const addressType = utils.addressType(proof.to);
        if (addressType == CardanoWasm.CredKind.Script) {
            action = '2';
        }
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str(action),
                ls
            )
        )
    }

    static async transferFromTreasury(protocolParams, utxosForFee, utxosToSpend, scriptRefUtxo, groupNFTUtxo, funValue, toAddr, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef, changeAddress, evaluateTxFn, signFn, rawMetaData, ttl) {
        const signedTx = await TreasuryScript.transferFromTreasuryWithoutEvaluate(protocolParams, utxosForFee, utxosToSpend, scriptRefUtxo, groupNFTUtxo, funValue, toAddr, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef, changeAddress, signFn, rawMetaData, ttl);
        // return signedTx;
        // console.log(signedTx.to_json());
        const exUnitEVA = await evaluateTxFn(signedTx.to_hex());
        if (!exUnitEVA) throw 'evaluate failed';
        let total_ex_mem = 0;
        let total_ex_cpu = 0;
        const gasMutipl = 1;
        for (const key in exUnitEVA) {
            const exUnit = exUnitEVA[key];
            total_ex_mem += Math.floor(exUnit.memory * gasMutipl);
            total_ex_cpu += Math.floor(exUnit.steps * gasMutipl);
        }

        if (protocolParams.maxExecutionUnitsPerTransaction.memory < total_ex_mem || protocolParams.maxExecutionUnitsPerTransaction.steps < total_ex_cpu) {
            throw `ExUnit too large: memory:${total_ex_mem} ,steps:${total_ex_cpu}`;
        }

        const txBuilder = utils.initTxBuilder(protocolParams);

        const isTreasury = utils.addressToPkhOrScriptHash(redeemProof.to) == TreasuryScript.script().hash().to_hex();
        const groupInfo = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
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
        txBuilder.set_collateral(txCollateralInputBuilder);

        const spendInputs = CardanoWasm.TxInputsBuilder.new();

        const redeemerData = TreasuryScript.redeemProof(redeemProof);//(toAddr, funValueMap, utxosForFee[0]);
        // console.log('redeemer:', redeemerData.to_json());


        const datum42 = utils.genDemoDatum42();
        // const datum42 = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        const refenceInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(scriptRefUtxo.txHash), scriptRefUtxo.index);
        const authorityCheckRefenceInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(treasuryCheckRef.txHash), treasuryCheckRef.index);

        for (let i = 0; i < utxosToSpend.length; i++) {
            const utxoToSpend = utxosToSpend[i];
            inputs_arr.push(utxoToSpend.txHash + '#' + utxoToSpend.index);
        }
        inputs_arr.push(treasuryCheckUxto.txHash + '#' + treasuryCheckUxto.index);
        inputs_arr.sort();
        const treasuryCheckAddress = CardanoWasm.Address.from_bech32(treasuryCheckUxto.address);
        const treasuryCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(treasuryCheckUxto.address));
        {
            const utxoToSpend = treasuryCheckUxto;

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);

            // let ex_unit_mem = 6813968;//  4142333
            // let ex_unit_cpu = 2482846811;// 1447050275
            const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            let ex_unit_mem = Math.floor(exUnitEVA['spend:' + index].memory * gasMutipl);//7575293;//  4142333
            let ex_unit_cpu = Math.floor(exUnitEVA['spend:' + index].steps * gasMutipl);//2880092692; 1447050275

            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((ex_unit_mem) + ''),
                CardanoWasm.BigNum.from_str((ex_unit_cpu) + '')
            );

            const redeemer = CardanoWasm.Redeemer.new(CardanoWasm.RedeemerTag.new_spend(), CardanoWasm.BigNum.from_str('0'), redeemerData, exUnits);

            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(treasuryCheckRef);

            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(CardanoWasm.PlutusScriptSource.new_ref_input(
                treasuryCheckScriptHash, authorityCheckRefenceInput, scriptTmp.language_version(), scriptSize)
                , redeemer);

            txInputBuilder.add_plutus_script_input(witness, input, value);

            const valueOutputOfTreasuryCheckScript = utils.funValue(treasuryCheckUxto.value);
            // console.log('====<', valueOutputOfTreasuryCheckScript.to_json());
            const minAda = utils.getMinAdaOfUtxo(protocolParams, treasuryCheckAddress, valueOutputOfTreasuryCheckScript, datum42);
            if (valueOutputOfTreasuryCheckScript.coin().less_than(CardanoWasm.BigNum.from_str('' + minAda))) {
                valueOutputOfTreasuryCheckScript.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
            }

            const treasuryCheckOutput = CardanoWasm.TransactionOutput.new(treasuryCheckAddress, valueOutputOfTreasuryCheckScript);
            treasuryCheckOutput.set_plutus_data(datum42);
            txBuilder.add_output(treasuryCheckOutput);

        }
        const [policy_id, tokenName] = redeemProof.tokenId.split('.')
        for (let i = 0; i < utxosToSpend.length; i++) {
            const utxoToSpend = utxosToSpend[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);
            const from = CardanoWasm.Address.from_bech32(utxoToSpend.address);

            const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            let ex_unit_mem = Math.floor(exUnitEVA['spend:' + index].memory * gasMutipl);//7575293;//  4142333
            let ex_unit_cpu = Math.floor(exUnitEVA['spend:' + index].steps * gasMutipl);//2880092692; 1447050275

            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((ex_unit_mem) + ''),//(EX_UNIT_A),2738702
                CardanoWasm.BigNum.from_str((ex_unit_cpu) + '')//(EX_UNIT_B)727869902 702471775
            );

            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('0'),
                // redeemerData,
                CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
                exUnits
            );

            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(scriptRefUtxo);

            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(CardanoWasm.PlutusScriptSource.new_ref_input(
                scriptTmp.hash(), refenceInput, scriptTmp.language_version(), scriptSize)
                , redeemer);
            // const witness = CardanoWasm.PlutusWitness.new(TreasuryScript.script(),datum42,redeemer);
            txInputBuilder.add_plutus_script_input(witness, input, value);
            spendInputs.add_plutus_script_input(witness, input, value);
        }

        txBuilder.set_inputs(txInputBuilder);

        let transferValue = { coins: redeemProof.adaAmount*1 , assets: redeemProof.tokenId ? { [redeemProof.tokenId]: redeemProof.amount } : {} };
        if (redeemProof.txType === TreasuryScript.BALANCETX) {
            transferValue = { coins: 0, assets: redeemProof.tokenId ? { [redeemProof.tokenId]: 0 } : {} }
        }
        const outputValue = utils.funValue(transferValue);
        let minAdaOfTransferOutput = utils.getMinAdaOfUtxo(protocolParams, redeemProof.to, transferValue, isTreasury ? datum42 : undefined)
        if (redeemProof.adaAmount * 1 < minAdaOfTransferOutput && redeemProof.txType != TreasuryScript.BALANCETX) throw 'output coins less than min ada';

        // console.log(outputValue.to_json());
        // const fakeValue = outputValue.checked_add(CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('1')));
        let output;
        if(redeemProof.additionalAda){
            const addtionalValue = { coins: redeemProof.adaAmount*1 + redeemProof.additionalAda*1, assets: redeemProof.tokenId ? { [redeemProof.tokenId]: redeemProof.amount } : {} }
            output = CardanoWasm.TransactionOutput.new(CardanoWasm.Address.from_bech32(toAddr), utils.funValue(addtionalValue));
        }else{
            output = CardanoWasm.TransactionOutput.new(CardanoWasm.Address.from_bech32(toAddr), outputValue);
        }
        if (utils.addressType(toAddr) == CardanoWasm.CredKind.Script) {
            output.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData));
        }
        // console.log('To:', CardanoWasm.BaseAddress.from_address(CardanoWasm.Address.from_bech32(toAddr)).payment_cred().to_keyhash().to_hex())//72ebc8498ce173916e5d819725f33dac499a0ce9f5e82f2dcef88876

        let valueOutputOfTreasury;
        if (spendInputs.total_value().coin().less_than(outputValue.coin())) {
            //if ada is not enough, set ada value of change to be zero 
            //it's means leader shouder cover all the ada of all the change outs of treasury
            valueOutputOfTreasury = spendInputs.total_value().checked_add(CardanoWasm.Value.new(outputValue.coin())).checked_sub(outputValue);
            valueOutputOfTreasury.set_coin(CardanoWasm.BigNum.from_str('0'));
        } else {
            valueOutputOfTreasury = spendInputs.total_value().checked_sub(outputValue);
        }

        // console.log(valueOutputOfTreasury.total_value().to_json())

        // console.log('valueChangeOfTreasuryScript=', valueOutputOfTreasury.to_json());

        let changeValuePerUtxo;
        let changeValueLastUtxo;

        let noChange = valueOutputOfTreasury.is_zero();//true;
        // if (redeemProof.tokenId == '') {
        //     noChange = valueOutputOfTreasury.is_zero();
        // } else {
        //     if (valueOutputOfTreasury.multiasset()) {
        //         const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        //         const asset = valueOutputOfTreasury.multiasset().get_asset(CardanoWasm.ScriptHash.from_hex(policy_id), assetName);
        //         // console.log(asset.to_str());
        //         noChange = valueOutputOfTreasury.is_zero();//asset.is_zero();
        //     } else {
        //         noChange = true;
        //     }
        // }

        const outputCount = redeemProof.outputCount;
        if (noChange && outputCount > 0 || !noChange && outputCount <= 0) throw `outputCount = ${outputCount} not match change flag ${!noChange}`;

        // if(noChange && outputCount > 0 || !noChange && outputCount <= 0) throw `treasury change value = ${!noChange} is mismatch with outputCount = ${redeemProof.outputCount}`;
        if (!noChange && outputCount > 0) {

            if (redeemProof.tokenId === '') {// cross ada
                const totalChange = valueOutputOfTreasury.coin().to_str() * 1;
                const coinPerUtxo = Math.floor(totalChange / outputCount);

                changeValuePerUtxo = utils.funValue({ coins: coinPerUtxo, assets: {} });
                changeValueLastUtxo = utils.funValue({ coins: totalChange - coinPerUtxo * (outputCount - 1), assets: {} });
                const minAda = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValuePerUtxo, datum42);
                const minAdaLast = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValueLastUtxo, datum42);
                if (coinPerUtxo * outputCount > totalChange || coinPerUtxo < minAda || minAdaLast > totalChange - coinPerUtxo * (outputCount - 1)) {
                    throw 'change is insufficient';
                }
            } else {
                // const [policy_id, tokenName] = redeemProof.tokenId.split('.');
                // console.log(valueOutputOfTreasury.to_json());
                const assetsTmp = valueOutputOfTreasury.multiasset();
                // console.log(valueOutputOfTreasuryCheckScript.to_json());
                const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
                const totalChange = assetsTmp ? assetsTmp.get_asset(CardanoWasm.ScriptHash.from_hex(policy_id), assetName).to_str() * 1 : 0;
                const totalAda = valueOutputOfTreasury.coin().to_str() * 1;
                const tokenAmountPerUtxo = Math.floor(totalChange / outputCount);
                const adaAmountPerUtxo = Math.floor(totalAda / outputCount);
                changeValuePerUtxo = utils.funValue({ coins: adaAmountPerUtxo, assets: { [redeemProof.tokenId]: tokenAmountPerUtxo } });
                changeValueLastUtxo = utils.funValue({ coins: totalAda - adaAmountPerUtxo * (outputCount - 1), assets: { [redeemProof.tokenId]: totalChange - tokenAmountPerUtxo * (outputCount - 1) } });
                const minAda = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValuePerUtxo, datum42);
                const minAdaLast = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValueLastUtxo, datum42);
                if (adaAmountPerUtxo < minAda) {
                    changeValuePerUtxo.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
                }
                if (changeValueLastUtxo.coin().less_than(CardanoWasm.BigNum.from_str('' + minAdaLast))) {
                    changeValueLastUtxo.set_coin(CardanoWasm.BigNum.from_str('' + minAdaLast));
                }

            }
            // console.log(changeValueLastUtxo.to_json());
            for (let i = 0; i < outputCount; i++) {

                let treasuryChangeOutput;
                if (i == outputCount - 1) {
                    treasuryChangeOutput = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValueLastUtxo);
                }
                else {
                    treasuryChangeOutput = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValuePerUtxo);
                }
                treasuryChangeOutput.set_plutus_data(datum42);
                txBuilder.add_output(treasuryChangeOutput);
                // console.log('treasuryChangeOutput:', treasuryChangeOutput.to_json());
            }

        }

        if (noChange && !valueOutputOfTreasury.is_zero()) {
            const minAda = utils.getMinAdaOfUtxo(protocolParams, redeemProof.to, valueOutputOfTreasury, datum42);
            if (minAda > valueOutputOfTreasury.coin().to_str() * 1) {
                valueOutputOfTreasury.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
            }
            const treasuryChangeOutput = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), valueOutputOfTreasury);
            treasuryChangeOutput.set_plutus_data(datum42);
            txBuilder.add_output(treasuryChangeOutput);
        }
        if (utils.addressToPkhOrScriptHash(toAddr) == TreasuryScript.script().hash().to_hex()) {
            output.set_plutus_data(datum42);
        } else {
            txBuilder.add_output(output);
        }


        const groupInfoTokenInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(groupNFTUtxo.txHash)
            , groupNFTUtxo.index
        );
        txBuilder.add_reference_input(groupInfoTokenInput);
        // txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(adminpkhash));

        // const costModesLib = CardanoWasm.TxBuilderConstants.plutus_vasil_cost_models();
        // const costModesLib = protocolParams.costModels;
        const costModesLib = getCostModels(protocolParams);//badf62fa873deb5b8f423159136cff579066f43e6276f2fb33bede7ac1ef09f9
        txBuilder.calc_script_data_hash(costModesLib);

        // txBuilder.set_script_data_hash(CardanoWasm.ScriptDataHash.from_hex('2d6310830f281dcc368c424dfb93bac0cf60815c97da98525371766522365355'));

        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        // const redeemers = CardanoWasm.Redeemers.new();
        // redeemers.add(redeemer);
        // const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // txBuilder.set_script_data_hash(hash);



        txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.BalanceWorker]));

        const minFee = txBuilder.min_fee();
        // console.log('minFee:', minFee.to_str());
        txBuilder.set_total_collateral_and_return(minFee.checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        if (rawMetaData) {
            // txBuilder.set_auxiliary_data(rawMetaData);
            TreasuryScript.setMetaData(txBuilder, rawMetaData);
        }
        if (ttl && redeemProof.ttl >= ttl) {
            txBuilder.set_ttl(ttl);
        } else {
            throw `bad ttl: ${ttl}`
        }


        // txBuilder.add_json_metadatum(CardanoWasm.BigNum.from_str('0'),JSON.stringify(metaData));
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));


        let tx = txBuilder.build_tx();
        // console.log('script data hash:',tx.body().script_data_hash().to_hex());
        // console.log('body:',tx.to_json())

        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);

        // console.log('script data hash:', body.script_data_hash().to_hex())
        // console.log('real Fee:', tx.body().fee().to_str());
        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());

    }

    static async transferFromTreasuryWithoutEvaluate(protocolParams, utxosForFee, utxosToSpend, scriptRefUtxo, groupNFTUtxo, funValue, toAddr, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef, changeAddress, signFn, rawMetaData, ttl) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        const isTreasury = utils.addressToPkhOrScriptHash(redeemProof.to) == TreasuryScript.script().hash().to_hex();
        const groupInfo = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
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
        txBuilder.set_collateral(txCollateralInputBuilder);

        const spendInputs = CardanoWasm.TxInputsBuilder.new();

        const redeemerData = TreasuryScript.redeemProof(redeemProof);//(toAddr, funValueMap, utxosForFee[0]);
        // console.log('redeemer:', redeemerData.to_json());


        const datum42 = utils.genDemoDatum42();
        // const datum42 = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        const refenceInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(scriptRefUtxo.txHash), scriptRefUtxo.index);
        const authorityCheckRefenceInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(treasuryCheckRef.txHash), treasuryCheckRef.index);

        for (let i = 0; i < utxosToSpend.length; i++) {
            const utxoToSpend = utxosToSpend[i];
            inputs_arr.push(utxoToSpend.txHash + '#' + utxoToSpend.index);
        }
        inputs_arr.sort();
        let total_ex_mem = 0;
        let total_ex_cpu = 0;

        const treasuryCheckAddress = CardanoWasm.Address.from_bech32(treasuryCheckUxto.address);
        const treasuryCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(treasuryCheckUxto.address));
        {
            const utxoToSpend = treasuryCheckUxto;

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);

            let ex_unit_mem = 1213968;//  4142333
            let ex_unit_cpu = 482846811;// 1447050275

            // console.log('mem:', ex_unit_mem, 'cpu:', ex_unit_cpu);
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((ex_unit_mem) + ''),
                CardanoWasm.BigNum.from_str((ex_unit_cpu) + '')
            );
            total_ex_mem += ex_unit_mem;
            total_ex_cpu += ex_unit_cpu;

            const redeemer = CardanoWasm.Redeemer.new(CardanoWasm.RedeemerTag.new_spend(), CardanoWasm.BigNum.from_str('0'), redeemerData, exUnits);


            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(treasuryCheckRef);
            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(CardanoWasm.PlutusScriptSource.new_ref_input(
                treasuryCheckScriptHash, authorityCheckRefenceInput, scriptTmp.language_version(), scriptSize)
                , redeemer);

            txInputBuilder.add_plutus_script_input(witness, input, value);

            const valueOutputOfTreasuryCheckScript = utils.funValue(treasuryCheckUxto.value);
            // console.log('====<', valueOutputOfTreasuryCheckScript.to_json());
            const minAda = utils.getMinAdaOfUtxo(protocolParams, treasuryCheckAddress, valueOutputOfTreasuryCheckScript, datum42);
            if (valueOutputOfTreasuryCheckScript.coin().less_than(CardanoWasm.BigNum.from_str('' + minAda))) {
                valueOutputOfTreasuryCheckScript.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
            }

            const treasuryCheckOutput = CardanoWasm.TransactionOutput.new(treasuryCheckAddress, valueOutputOfTreasuryCheckScript);
            treasuryCheckOutput.set_plutus_data(datum42);
            txBuilder.add_output(treasuryCheckOutput);

        }
        const [policy_id, tokenName] = redeemProof.tokenId.split('.')
        for (let i = 0; i < utxosToSpend.length; i++) {
            const utxoToSpend = utxosToSpend[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);
            const from = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            let ex_unit_mem = 2211410;//EX_UINT_MEM_ONLY_ONE; 2211410
            let ex_unit_cpu = 66477634;//EX_UINT_CPU_ONLY_ONE; 663013608

            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((ex_unit_mem) + ''),//(EX_UNIT_A),2738702
                CardanoWasm.BigNum.from_str((ex_unit_cpu) + '')//(EX_UNIT_B)727869902 702471775
            );
            total_ex_mem += ex_unit_mem;
            total_ex_cpu += ex_unit_cpu;

            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('0'),
                // redeemerData,
                CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
                exUnits
            );

            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(scriptRefUtxo);
            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(CardanoWasm.PlutusScriptSource.new_ref_input(
                scriptTmp.hash(), refenceInput, scriptTmp.language_version(), scriptSize)
                , redeemer);
            // const witness = CardanoWasm.PlutusWitness.new(TreasuryScript.script(),datum42,redeemer);
            txInputBuilder.add_plutus_script_input(witness, input, value);
            spendInputs.add_plutus_script_input(witness, input, value);
        }
        // console.log('total_mem:', total_ex_mem, 'total_cpu:', total_ex_cpu);
        txBuilder.set_inputs(txInputBuilder);

        let transferValue = { coins: redeemProof.adaAmount, assets: redeemProof.tokenId ? { [redeemProof.tokenId]: redeemProof.amount } : {} };
        if (redeemProof.txType === TreasuryScript.BALANCETX) {
            transferValue = { coins: 0, assets: redeemProof.tokenId ? { [redeemProof.tokenId]: 0 } : {} }
        }
        const outputValue = utils.funValue(transferValue);
        let minAdaOfTransferOutput = utils.getMinAdaOfUtxo(protocolParams, redeemProof.to, transferValue, isTreasury ? datum42 : undefined)
        if (redeemProof.adaAmount * 1 < minAdaOfTransferOutput && redeemProof.txType != TreasuryScript.BALANCETX) throw 'output coins less than min ada';

        // console.log(outputValue.to_json());
        // const fakeValue = outputValue.checked_add(CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('1')));
        // let output = CardanoWasm.TransactionOutput.new(CardanoWasm.Address.from_bech32(toAddr), outputValue);
        let output;
        if(redeemProof.additionalAda){
            const addtionalValue = { coins: redeemProof.adaAmount*1 + redeemProof.additionalAda*1, assets: redeemProof.tokenId ? { [redeemProof.tokenId]: redeemProof.amount } : {} }
            output = CardanoWasm.TransactionOutput.new(CardanoWasm.Address.from_bech32(toAddr), utils.funValue(addtionalValue));
        }else{
            output = CardanoWasm.TransactionOutput.new(CardanoWasm.Address.from_bech32(toAddr), outputValue);
        }
        if (utils.addressType(toAddr) == CardanoWasm.CredKind.Script) {
            output.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData));
        }
        // console.log('To:', CardanoWasm.BaseAddress.from_address(CardanoWasm.Address.from_bech32(toAddr)).payment_cred().to_keyhash().to_hex())//72ebc8498ce173916e5d819725f33dac499a0ce9f5e82f2dcef88876

        // let valueOutputOfTreasury = spendInputs.total_value().checked_sub(outputValue);
        let valueOutputOfTreasury;
        if (spendInputs.total_value().coin().less_than(outputValue.coin())) {
            //if ada is not enough, set ada value of change to be zero 
            //it's means leader shouder cover all the ada of all the change outs of treasury
            valueOutputOfTreasury = spendInputs.total_value().checked_add(CardanoWasm.Value.new(outputValue.coin())).checked_sub(outputValue);
            valueOutputOfTreasury.set_coin(CardanoWasm.BigNum.from_str('0'));
        } else {
            valueOutputOfTreasury = spendInputs.total_value().checked_sub(outputValue);
        }

        // console.log('valueOutputOfTreasury=', valueOutputOfTreasury.to_json());

        let changeValuePerUtxo;
        let changeValueLastUtxo;

        let noChange = valueOutputOfTreasury.is_zero();//true;
        // if (redeemProof.tokenId == '') {
        //     noChange = valueOutputOfTreasury.is_zero();
        // } else {
        //     if (valueOutputOfTreasury.multiasset()) {
        //         const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        //         const asset = valueOutputOfTreasury.multiasset().get_asset(CardanoWasm.ScriptHash.from_hex(policy_id), assetName);
        //         // console.log(asset.to_str());
        //         noChange = valueOutputOfTreasury.is_zero();//asset.is_zero();
        //     } else {
        //         noChange = true;
        //     }
        // }

        const outputCount = redeemProof.outputCount;
        if (noChange && outputCount > 0 || !noChange && outputCount <= 0) throw `outputCount = ${outputCount} not match change flag ${!noChange}`;

        // if(noChange && outputCount > 0 || !noChange && outputCount <= 0) throw `treasury change value = ${!noChange} is mismatch with outputCount = ${redeemProof.outputCount}`;
        if (!noChange && outputCount > 0) {

            if (redeemProof.tokenId === '') {// cross ada
                const totalChange = valueOutputOfTreasury.coin().to_str() * 1;
                const coinPerUtxo = Math.floor(totalChange / outputCount);

                changeValuePerUtxo = utils.funValue({ coins: coinPerUtxo, assets: {} });
                changeValueLastUtxo = utils.funValue({ coins: totalChange - coinPerUtxo * (outputCount - 1), assets: {} });
                const minAda = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValuePerUtxo, datum42);
                const minAdaLast = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValueLastUtxo, datum42);
                if (coinPerUtxo * outputCount > totalChange || coinPerUtxo < minAda || minAdaLast > totalChange - coinPerUtxo * (outputCount - 1)) {
                    throw 'change is insufficient';
                }
            } else {
                // const [policy_id, tokenName] = redeemProof.tokenId.split('.');
                const assetsTmp = valueOutputOfTreasury.multiasset();
                // console.log(valueOutputOfTreasuryCheckScript.to_json());
                const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
                const totalChange = assetsTmp ? assetsTmp.get_asset(CardanoWasm.ScriptHash.from_hex(policy_id), assetName).to_str() * 1 : 0;
                const totalAda = valueOutputOfTreasury.coin().to_str() * 1;
                const tokenAmountPerUtxo = Math.floor(totalChange / outputCount);
                const adaAmountPerUtxo = Math.floor(totalAda / outputCount);
                changeValuePerUtxo = utils.funValue({ coins: adaAmountPerUtxo, assets: { [redeemProof.tokenId]: tokenAmountPerUtxo } });
                changeValueLastUtxo = utils.funValue({ coins: totalAda - adaAmountPerUtxo * (outputCount - 1), assets: { [redeemProof.tokenId]: totalChange - tokenAmountPerUtxo * (outputCount - 1) } });
                const minAda = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValuePerUtxo, datum42);
                const minAdaLast = utils.getMinAdaOfUtxo(protocolParams, TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValueLastUtxo, datum42);
                if (adaAmountPerUtxo < minAda) {
                    changeValuePerUtxo.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
                }
                if (changeValueLastUtxo.coin().less_than(CardanoWasm.BigNum.from_str('' + minAdaLast))) {
                    changeValueLastUtxo.set_coin(CardanoWasm.BigNum.from_str('' + minAdaLast));
                }

            }
            // console.log(changeValueLastUtxo.to_json());
            for (let i = 0; i < outputCount; i++) {

                let treasuryChangeOutput;
                if (i == outputCount - 1) {
                    treasuryChangeOutput = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValueLastUtxo);
                }
                else {
                    treasuryChangeOutput = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), changeValuePerUtxo);
                }
                treasuryChangeOutput.set_plutus_data(datum42);
                txBuilder.add_output(treasuryChangeOutput);
                // console.log('treasuryChangeOutput:', treasuryChangeOutput.to_json());
            }

        }

        if (noChange && !valueOutputOfTreasury.is_zero()) {
            const minAda = utils.getMinAdaOfUtxo(protocolParams, redeemProof.to, valueOutputOfTreasury, datum42);
            if (minAda > valueOutputOfTreasury.coin().to_str() * 1) {
                valueOutputOfTreasury.set_coin(CardanoWasm.BigNum.from_str('' + minAda));
            }
            const treasuryChangeOutput = CardanoWasm.TransactionOutput.new(TreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), valueOutputOfTreasury);
            treasuryChangeOutput.set_plutus_data(datum42);
            txBuilder.add_output(treasuryChangeOutput);
        }
        if (utils.addressToPkhOrScriptHash(toAddr) == TreasuryScript.script().hash().to_hex()) {
            output.set_plutus_data(datum42);
        } else {
            txBuilder.add_output(output);
        }


        const groupInfoTokenInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(groupNFTUtxo.txHash)
            , groupNFTUtxo.index
        );
        txBuilder.add_reference_input(groupInfoTokenInput);
        // txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(adminpkhash));

        // const costModesLib = CardanoWasm.TxBuilderConstants.plutus_vasil_cost_models();
        // const costModesLib = protocolParams.costModels;
        const costModesLib = getCostModels(protocolParams);//badf62fa873deb5b8f423159136cff579066f43e6276f2fb33bede7ac1ef09f9
        txBuilder.calc_script_data_hash(costModesLib);

        // txBuilder.set_script_data_hash(CardanoWasm.ScriptDataHash.from_hex('2d6310830f281dcc368c424dfb93bac0cf60815c97da98525371766522365355'));

        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        // const redeemers = CardanoWasm.Redeemers.new();
        // redeemers.add(redeemer);
        // const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // txBuilder.set_script_data_hash(hash);



        txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.BalanceWorker]));

        const minFee = txBuilder.min_fee();
        // console.log('minFee:', minFee.to_str());
        txBuilder.set_total_collateral_and_return(minFee.checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        if (rawMetaData) {
            // txBuilder.set_auxiliary_data(rawMetaData);
            TreasuryScript.setMetaData(txBuilder, rawMetaData);
        }
        if (ttl && redeemProof.ttl >= ttl) {
            txBuilder.set_ttl(ttl);
        } else {
            throw `bad ttl: ${ttl}`
        }


        // txBuilder.add_json_metadatum(CardanoWasm.BigNum.from_str('0'),JSON.stringify(metaData));
        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));


        let tx = txBuilder.build_tx();
        // console.log('script data hash:',tx.body().script_data_hash().to_hex());
        // console.log('body:',tx.to_json())

        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);

        // console.log('script data hash:', body.script_data_hash().to_hex())
        // console.log('real Fee:', tx.body().fee().to_str());
        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());

    }

    static setMetaData(txBuilder, rawMetaData) {
        // console.log("[contracts.js] rawMetaData: ", rawMetaData)

        let metaData = CardanoWasm.encode_json_str_to_metadatum(JSON.stringify(rawMetaData), CardanoWasm.MetadataJsonSchema.BasicConversions);
        let genMetaData = CardanoWasm.GeneralTransactionMetadata.from_bytes(metaData.to_bytes());
        let auxiliaryData = CardanoWasm.AuxiliaryData.new();
        auxiliaryData.set_metadata(genMetaData);

        txBuilder.set_auxiliary_data(auxiliaryData);
    }
}

class MappingTokenScript {

    static script() {
        return mappingTokenScript;
    }

    static policy_id() {
        // return this.script().hash().to_hex();
        if (!MAPPINGTOKEN_POLICY) throw 'not initialized'
        return MAPPINGTOKEN_POLICY;
    }

    static tokenId(tokenName) {
        return this.policy_id() + '.' + Buffer.from(tokenName).toString('hex');
    }

    static genMetaData(rawMetaData) {
        let metaData = CardanoWasm.encode_json_str_to_metadatum(JSON.stringify(rawMetaData), CardanoWasm.MetadataJsonSchema.BasicConversions);
        let genMetaData = CardanoWasm.GeneralTransactionMetadata.from_bytes(metaData.to_bytes());
        let auxiliaryData = CardanoWasm.AuxiliaryData.new();
        auxiliaryData.set_metadata(genMetaData);
        return auxiliaryData;
    }

    // static setMetaData(txBuilder, rawMetaData) {
    //     console.log("[contracts.js] rawMetaData: ", rawMetaData)

    //     let metaData = CardanoWasm.encode_json_str_to_metadatum(JSON.stringify(rawMetaData), CardanoWasm.MetadataJsonSchema.BasicConversions);
    //     let genMetaData = CardanoWasm.GeneralTransactionMetadata.from_bytes(metaData.to_bytes());
    //     let auxiliaryData = CardanoWasm.AuxiliaryData.new();
    //     auxiliaryData.set_metadata(genMetaData);

    //     txBuilder.set_auxiliary_data(auxiliaryData);
    // }

    static async burn(protocolParams, utxosForFee, utxoForCollateral, scriptRef, utxosToBurn, tokenId, burnedAmount, changeAddress, evaluateTxFn, signFn, ttl, rawMetaData) {
        const txBuilder = utils.initTxBuilder(protocolParams);

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

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);
        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash()
            , scriptRefInput, scriptTmp.language_version(), scriptSize);

        const exUnitsMint = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((2667720) + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str((539630005) + '')//(EX_UNIT_B)306405352
        );

        const mintRedeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
            exUnitsMint
        );
        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(mint_plutus_script_source, mintRedeemer);

        const [policy_id, tokenName] = tokenId.split('.');
        const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('-' + burnedAmount));



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

        if (rawMetaData) {
            txBuilder.set_auxiliary_data(MappingTokenScript.genMetaData(rawMetaData));
        }
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

        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
    }

    static async mintWithoutEvaluate(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, changeAddress, signFn, ttl, rawMetaData) {
        const txBuilder = utils.initTxBuilder(protocolParams);
        const groupInfo = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);
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

        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );

        const { script: scriptTmp2, scriptSize: scriptSize2 } = utils.plutusScriptFromScriptRef(scriptRef);
        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp2.hash()
            , scriptRefInput, scriptTmp2.language_version(), scriptSize2);

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

        const [policy_id, tokenName] = redeemProof.tokenId.split('.');
        const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('' + redeemProof.amount));




        //step1: construct reference input
        const groupNFTRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(groupNFTUtxo.txHash), groupNFTUtxo.index);
        const mintCheckRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(mintCheckScriptRef.txHash), mintCheckScriptRef.index);
        const mintCheckInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(mintCheckUtxo.txHash), mintCheckUtxo.index);

        const mintCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(mintCheckUtxo.address));

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(mintCheckScriptRef);

        const mint_check_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(mintCheckScriptHash, mintCheckRefInput, scriptTmp.language_version(), scriptSize);
        const exUnitsSpendMintCheck = CardanoWasm.ExUnits.new(CardanoWasm.BigNum.from_str((4433118) + ''), CardanoWasm.BigNum.from_str((1416265282) + ''));
        const redeemerData = MintCheckScript.redeemProof(redeemProof);
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_spend(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnitsSpendMintCheck
        );

        const mintCheckWitness = CardanoWasm.PlutusWitness.new_with_ref(mint_check_plutus_script_source
            , CardanoWasm.DatumSource.new_ref_input(mintCheckInput)
            , redeemer)



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

        // const params = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);
        // const requiredSigner = params[contractMgr.GroupNFT.BalanceWorker];


        const toAddr = CardanoWasm.Address.from_bech32(redeemProof.to);
        const scriptHash = MappingTokenScript.script().hash();
        let testDatum;
        if (utils.addressType(redeemProof.to) == CardanoWasm.CredKind.Script) {
            testDatum = CardanoWasm.PlutusData.from_hex(redeemProof.userData);
        }
        // const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [redeemProof.tokenId]: redeemProof.amount } }, testDatum) + (redeemProof.additionalAda?redeemProof.additionalAda*1:0);
        let minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [redeemProof.tokenId]: redeemProof.amount } }, testDatum);
        minAdaWithMintToken = minAdaWithMintToken*1 > (redeemProof.additionalAda?redeemProof.additionalAda*1:0)? minAdaWithMintToken*1 : redeemProof.additionalAda*1;
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('' + redeemProof.amount));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
        mintedValue.set_multiasset(mutiAsset);
        const outputOfMint = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);
        if (utils.addressType(redeemProof.to) == CardanoWasm.CredKind.Script) {
            outputOfMint.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData));
        }



        const mintCheckUtxovalue = utils.funValue(mintCheckUtxo.value);
        const mintcheckAddress = CardanoWasm.Address.from_bech32(mintCheckUtxo.address);
        const minAdaOfMintCheckChangeUtxo = utils.getMinAdaOfUtxo(protocolParams, mintcheckAddress, mintCheckUtxovalue, utils.genDemoDatum42());
        const checkTokenAssetName = CardanoWasm.AssetName.new(Buffer.from(MintCheckTokenScript.tokenName()));
        const multiAssetOfCheckToken = CardanoWasm.MultiAsset.new();
        const mintCheckTokenAsset = CardanoWasm.Assets.new();
        mintCheckTokenAsset.insert(checkTokenAssetName, CardanoWasm.BigNum.from_str('1'));
        multiAssetOfCheckToken.insert(MintCheckTokenScript.script().hash(), mintCheckTokenAsset) //(checkTokenAssetName,CardanoWasm.Int.from_str('1'));
        const outputMintCheckChange = CardanoWasm.TransactionOutput.new(
            mintcheckAddress,
            CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaOfMintCheckChangeUtxo), multiAssetOfCheckToken));
        outputMintCheckChange.set_plutus_data(utils.genDemoDatum42());



        txBuilder.set_mint_builder(mintBuilder);
        txBuilder.add_reference_input(groupNFTRefInput);
        txBuilder.add_plutus_script_input(mintCheckWitness, mintCheckInput, utils.funValue(mintCheckUtxo.value));
        txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.BalanceWorker]));
        txBuilder.add_output(outputOfMint);
        txBuilder.add_output(outputMintCheckChange);

        if (rawMetaData) {
            txBuilder.set_auxiliary_data(MappingTokenScript.genMetaData(rawMetaData));
        }
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

        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
    }

    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, changeAddress, evaluateTxFn, signFn, ttl, rawMetaData) {
        const signedTx = await MappingTokenScript.mintWithoutEvaluate(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, changeAddress, signFn, ttl, rawMetaData);
        // return signedTx;
        const exUnitEVA = await evaluateTxFn(signedTx.to_hex());
        if (!exUnitEVA) throw 'evaluate failed';
        const groupInfo = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);
        let total_ex_mem = 0;
        let total_ex_cpu = 0;
        const gasMutipl = 1;
        for (const key in exUnitEVA) {
            const exUnit = exUnitEVA[key];
            total_ex_mem += Math.floor(exUnit.memory * gasMutipl);
            total_ex_cpu += Math.floor(exUnit.total_ex_cpu * gasMutipl);
        }

        if (protocolParams.maxExecutionUnitsPerTransaction.memory < total_ex_mem || protocolParams.maxExecutionUnitsPerTransaction.steps < total_ex_cpu) {
            throw `ExUnit too large: memory:${total_ex_mem} ,steps:${total_ex_cpu}`;
        }


        const txBuilder = utils.initTxBuilder(protocolParams);

        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            // totalInputValue = totalInputValue.checked_add(value);
            txBuilder.add_regular_input(from, input, value);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
        }
        inputs_arr.push(mintCheckUtxo.txHash + '#' + mintCheckUtxo.index);
        inputs_arr.sort();

        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );

        const { script: scriptTmp2, scriptSize: scriptSize2 } = utils.plutusScriptFromScriptRef(scriptRef);

        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp2.hash()
            , scriptRefInput,scriptTmp2.language_version(), scriptSize2);

        let ex_unit_mem = Math.floor(exUnitEVA['mint:0'].memory * gasMutipl);//7575293;//  4142333
        let ex_unit_cpu = Math.floor(exUnitEVA['mint:0'].steps * gasMutipl);//2880092692; 1447050275

        const exUnitsMint = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str(ex_unit_mem + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str(ex_unit_cpu + '')//(EX_UNIT_B)306405352
        );

        const mintRedeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
            exUnitsMint
        );
        let mint_witnes = CardanoWasm.MintWitness.new_plutus_script(mint_plutus_script_source, mintRedeemer);

        const [policy_id, tokenName] = redeemProof.tokenId.split('.');
        const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('' + redeemProof.amount));




        //step1: construct reference input
        const groupNFTRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(groupNFTUtxo.txHash), groupNFTUtxo.index);
        const mintCheckRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(mintCheckScriptRef.txHash), mintCheckScriptRef.index);
        const mintCheckInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_hex(mintCheckUtxo.txHash), mintCheckUtxo.index);

        const mintCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(mintCheckUtxo.address));

        const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(mintCheckScriptRef);

        const mint_check_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(mintCheckScriptHash, mintCheckRefInput, scriptTmp.language_version(), scriptSize);

        const index = inputs_arr.indexOf(mintCheckUtxo.txHash + '#' + mintCheckUtxo.index);
        let ex_unit_mem_spend = Math.floor(exUnitEVA['spend:' + index].memory * gasMutipl);//7575293;//  4142333
        let ex_unit_cpu_spend = Math.floor(exUnitEVA['spend:' + index].steps * gasMutipl);//2880092692; 1447050275
        const exUnitsSpendMintCheck = CardanoWasm.ExUnits.new(CardanoWasm.BigNum.from_str(ex_unit_mem_spend + ''), CardanoWasm.BigNum.from_str(ex_unit_cpu_spend + ''));
        const redeemerData = MintCheckScript.redeemProof(redeemProof);
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_spend(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnitsSpendMintCheck
        );
        const mintCheckWitness = CardanoWasm.PlutusWitness.new_with_ref(mint_check_plutus_script_source
            , CardanoWasm.DatumSource.new_ref_input(mintCheckInput)
            , redeemer)



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

        // const params = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);
        // const requiredSigner = params[contractMgr.GroupNFT.BalanceWorker];
        txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.BalanceWorker]));


        const toAddr = CardanoWasm.Address.from_bech32(redeemProof.to);
        const scriptHash = MappingTokenScript.script().hash();
        let testDatum;
        if (utils.addressType(redeemProof.to) == CardanoWasm.CredKind.Script) {
            testDatum = CardanoWasm.PlutusData.from_hex(redeemProof.userData);
        }
        let minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [redeemProof.tokenId]: redeemProof.amount } }, testDatum);
        minAdaWithMintToken = minAdaWithMintToken*1 > (redeemProof.additionalAda?redeemProof.additionalAda*1:0)? minAdaWithMintToken*1 : redeemProof.additionalAda*1;
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('' + redeemProof.amount));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + (minAdaWithMintToken)));
        // {
        //     const asset = CardanoWasm.Assets.new();
        //     asset.insert(CardanoWasm.AssetName.new(Buffer.from('4164612d57616e','hex')), CardanoWasm.BigNum.from_str('123'));
        //     mutiAsset.insert(CardanoWasm.ScriptHash.from_hex('924c3452ee0c3baeca9446edb6aebe032e7047ab1dafcd216b89ac5d'), asset);
        // }
        mintedValue.set_multiasset(mutiAsset);
        const outputOfMint = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);
        if (utils.addressType(redeemProof.to) == CardanoWasm.CredKind.Script) {
            outputOfMint.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData));
        }


        const mintCheckUtxovalue = utils.funValue(mintCheckUtxo.value);
        const mintcheckAddress = CardanoWasm.Address.from_bech32(mintCheckUtxo.address);
        const minAdaOfMintCheckChangeUtxo = utils.getMinAdaOfUtxo(protocolParams, mintcheckAddress, mintCheckUtxovalue, utils.genDemoDatum42());
        const checkTokenAssetName = CardanoWasm.AssetName.new(Buffer.from(MintCheckTokenScript.tokenName()));
        const multiAssetOfCheckToken = CardanoWasm.MultiAsset.new();
        const mintCheckTokenAsset = CardanoWasm.Assets.new();
        mintCheckTokenAsset.insert(checkTokenAssetName, CardanoWasm.BigNum.from_str('1'));
        multiAssetOfCheckToken.insert(MintCheckTokenScript.script().hash(), mintCheckTokenAsset) //(checkTokenAssetName,CardanoWasm.Int.from_str('1'));
        const outputMintCheckChange = CardanoWasm.TransactionOutput.new(
            mintcheckAddress,
            CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaOfMintCheckChangeUtxo), multiAssetOfCheckToken));
        outputMintCheckChange.set_plutus_data(utils.genDemoDatum42());



        txBuilder.set_mint_builder(mintBuilder);
        txBuilder.add_reference_input(groupNFTRefInput);
        txBuilder.add_plutus_script_input(mintCheckWitness, mintCheckInput, utils.funValue(mintCheckUtxo.value));
        // txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(requiredSigner));
        txBuilder.add_output(outputOfMint);
        txBuilder.add_output(outputMintCheckChange);

        if (rawMetaData) {
            txBuilder.set_auxiliary_data(MappingTokenScript.genMetaData(rawMetaData));
        }
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

        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
    }

}

class MintCheckScript {
    static script() {
        return mintCheckScript;
    }

    // static address() {

    //     return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(this.script().hash())).to_address();
    // }
    static address(stake_cred = undefined) {

        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(this.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(this.script().hash())).to_address();
        }
    }

    static caculateRedeemDataHash(redeemData) {
        // Builds CBOR-serialized ConstrPlutusData with 11 fields matching
        // MintCheckHashData in types.ak / MintCheckProofHashData in MintCheck.hs.
        // This replaces the old hex-string concatenation approach which had no
        // field delimiters and was vulnerable to boundary-ambiguity attacks.

        const { pkhPay, pkhStk } = utils.addressToHashs(redeemData.to);

        let [policy_id, tokenName] = ['', ''];
        if (redeemData.tokenId != '') {
            [policy_id, tokenName] = redeemData.tokenId.split('.');
        }

        let userData = '';
        const addressType = utils.addressType(redeemData.to);
        if (addressType == CardanoWasm.CredKind.Script) {
            if (redeemData.userData === undefined) throw 'userData required in caculateRedeemDataHash()';
            userData = Buffer.from(redeemData.userData, 'hex').toString('hex');//Just check useData don't have prefix '0x'
        }

        // Build PlutusData Constr 0 with 11 fields in canonical order
        const fields = CardanoWasm.PlutusList.new();
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(pkhPay, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(pkhStk ? pkhStk : '', 'hex')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(policy_id, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(tokenName, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.amount + '')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(redeemData.txHash, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.index + '')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.mode + '')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(redeemData.uniqueId, 'hex')));
        fields.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(redeemData.ttl + '')));
        fields.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(userData, 'hex')));

        const constrData = CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            fields
        );
        const hashCBOR = CardanoWasm.PlutusData.new_constr_plutus_data(constrData).to_hex();

        const shaObj = new jsSHA("SHA3-256", "UINT8ARRAY"/*,{encoding:"UTF8"}*/)
        shaObj.update(Buffer.from(hashCBOR, 'hex'));
        const dataHash = shaObj.getHash("HEX");

        return dataHash;
    }

    static redeemProof(proof) {//{"constructor":0,"fields":[]}
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.mintRedeemProof(proof))

        let action = '1';
        const addressType = utils.addressType(proof.to);
        if (addressType == CardanoWasm.CredKind.Script) {
            action = '2';
        }
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str(action),
                ls
            )
        )
    }

    static mintRedeemProof(proof) {
        const ls = CardanoWasm.PlutusList.new();
        const to = utils.addressToHashs(proof.to);

        let [policy_id, tokenName] = ['', '']
        if (proof.tokenId) [policy_id, tokenName] = proof.tokenId.split('.');

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(to.pkhPay, 'hex')));
        if(to.pkhStk) ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(to.pkhStk, 'hex')));
        else ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from('', 'hex')));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(policy_id, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(tokenName, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.amount + '')));
        // ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.adaAmount + '')));

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.txHash, 'hex')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.index + '')));

        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.mode + '')));

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.uniqueId, 'hex')));

        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.ttl + '')));

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));

        // return CardanoWasm.PlutusData.new_constr_plutus_data(
        //     CardanoWasm.ConstrPlutusData.new(
        //         CardanoWasm.BigNum.from_str('0'),
        //         ls
        //     )
        // )

        const addressType = utils.addressType(proof.to);
        if (addressType == CardanoWasm.CredKind.Script) {
            const lastls = CardanoWasm.PlutusList.new();
            if (proof.userData === undefined) throw 'userData required';
            const proofPart = CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    ls
                )
            )
            lastls.add(proofPart);
            lastls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.userData, 'hex')));
            return CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    lastls
                )
            )
        } else {
            return CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    ls
                )
            )
        }
    }

    static getRedeemerFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const parmsLs = redeemer.as_constr_plutus_data().data()
        const proofHex = parmsLs.get(0).as_constr_plutus_data().to_hex();
        return this.getMintRedeemerFromCBOR(proofHex);
    }

    static getMintRedeemerFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const parmsLs = redeemer.as_constr_plutus_data().data()  //.as_constr_plutus_data().data().get(0).as_list();
        if (parmsLs.len() == 2) {
            const ls = parmsLs.get(0).as_constr_plutus_data().data();
            const userData = Buffer.from(ls.get(1).as_bytes()).toString('hex');

            const toPKHPay = Buffer.from(ls.get(0).as_bytes()).toString('hex');
            const toPKHStk = Buffer.from(ls.get(1).as_bytes()).toString('hex');

            const policy_id = Buffer.from(ls.get(2).as_bytes()).toString('hex');
            const tokenName = Buffer.from(ls.get(3).as_bytes()).toString('hex');
            const tokenId = policy_id === '' ? '' : policy_id + '.' + tokenName;
            const amount = ls.get(4).as_integer().as_int().as_i32();
            // const adaAmount = ls.get(4).as_integer().as_int().as_i32();
            const txHash = Buffer.from(ls.get(5).as_bytes()).toString('hex');
            const index = ls.get(6).as_integer().as_int().as_i32();
            const mode = ls.get(7).as_integer().as_int().as_i32();
            const uniqueId = Buffer.from(ls.get(8).as_bytes()).toString('hex');
            const ttl = ls.get(9).as_integer().as_int().as_i32();
            const signature = Buffer.from(ls.get(10).as_bytes()).toString('hex');

            return { toPKHPay, toPKHStk, tokenId, amount, txHash, index, mode, uniqueId, signature, ttl, userData };
        } else {
            // const toPKH = Buffer.from(parmsLs.get(0).as_bytes()).toString('hex');
            const toPKHPay = Buffer.from(parmsLs.get(0).as_bytes()).toString('hex');
            const toPKHStk = Buffer.from(parmsLs.get(1).as_bytes()).toString('hex');

            const policy_id = Buffer.from(parmsLs.get(2).as_bytes()).toString('hex');
            const tokenName = Buffer.from(parmsLs.get(3).as_bytes()).toString('hex');
            const tokenId = policy_id === '' ? '' : policy_id + '.' + tokenName;
            const amount = parmsLs.get(4).as_integer().as_int().as_i32();
            // const adaAmount = parmsLs.get(4).as_integer().as_int().as_i32();
            const txHash = Buffer.from(parmsLs.get(5).as_bytes()).toString('hex');
            const index = parmsLs.get(6).as_integer().as_int().as_i32();
            const mode = parmsLs.get(7).as_integer().as_int().as_i32();
            const uniqueId = Buffer.from(parmsLs.get(8).as_bytes()).toString('hex');
            const ttl = parmsLs.get(9).as_integer().as_int().as_i32();
            const signature = Buffer.from(parmsLs.get(10).as_bytes()).toString('hex');

            return { toPKHPay, toPKHStk, tokenId, amount, txHash, index, mode, uniqueId, signature, ttl };
        }


    }

    static genBurnRedeemerData() {//{"constructor":0,"fields":[]}
        const ls = CardanoWasm.PlutusList.new();
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
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
            CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash(), checkTokenScriptRefInput, scriptTmp.language_version(), scriptSize)
            , redeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(MintCheckTokenScript.tokenName()));
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
        CardanoWasm.PlutusData.new_bytes(TreasuryScript.script().hash().to_bytes());
        // return CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
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

class TreasuryCheckTokenScript extends CheckTokenScriptBase {
    static script() {
        return treasuryCheckTokenScript;
    }

    static tokenName() {
        return 'TCheckCoin';
    }
}

class MintCheckTokenScript extends CheckTokenScriptBase {
    static script() {
        return mintCheckTokenScript;
    }

    static tokenName() {
        return 'MCheckCoin';
    }
}

class FakeToken {
    static script(adminPubKh) {
        // const nativeScripts = CardanoWasm.NativeScripts.new();
        const s = CardanoWasm.NativeScript.new_script_pubkey(CardanoWasm.ScriptPubkey.new(CardanoWasm.Ed25519KeyHash.from_hex(adminPubKh)));
        // nativeScripts.add(s);
        return s;
    }

    static policy_id(adminPubKh) {
        return this.script(adminPubKh).hash().to_hex();
    }

    static tokenId(adminPubKh, tokenName,encoding = 'ascii') {
        return this.policy_id(adminPubKh) + '.' + Buffer.from(tokenName, encoding).toString('hex');
    }

    static async mintNFT(protocolParams, utxosForFee, utxoForCollateral, adminPubKh, to, tokenName, amount, ttl, signFn, isNFT = false, meteData = undefined) {

        const txBuilder = utils.initTxBuilder(protocolParams);
        let changeAddr;

        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            changeAddr = from;
            txBuilder.add_regular_input(from, input, value);
        }

        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        const mintBuilder = CardanoWasm.MintBuilder.new();
        let mint_witnes = CardanoWasm.MintWitness.new_native_script(CardanoWasm.NativeScriptSource.new(FakeToken.script(adminPubKh)));
        const assetName = CardanoWasm.AssetName.new(Buffer.from(utils.genNFTAssetName(tokenName, meteData ? 100 : (isNFT ? 222 : 333)), 'hex'));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('' + amount));

        const toAddr = CardanoWasm.Address.from_bech32(to);
        const scriptHash = FakeToken.script(adminPubKh).hash();
        const tokenId = scriptHash.to_hex() + '.' + assetName.to_hex();
        const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [tokenId]: amount } },meteData);
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('' + amount));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken), mutiAsset);
        const outputOfMint = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);
        if (meteData) outputOfMint.set_plutus_data(meteData);
        txBuilder.add_output(outputOfMint);


        txBuilder.set_mint_builder(mintBuilder);
        const slightMinFee = txBuilder.min_fee();
        txBuilder.set_total_collateral_and_return(slightMinFee.checked_mul(CardanoWasm.BigNum.from_str('2')), changeAddr);
        //====================================================================================

        if (ttl) txBuilder.set_ttl(ttl);
        // txBuilder.add_required_signer( CardanoWasm.Ed25519KeyHash.from_hex(adminPubKh));
        txBuilder.add_change_if_needed(changeAddr);

        let tx = txBuilder.build_tx();
        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());
        // console.log('--->', CardanoWasm.PublicKey.from_bech32(signResult.vkey).hash().to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);
        // vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);
        const nativeScripts = CardanoWasm.NativeScripts.new();
        nativeScripts.add(FakeToken.script(adminPubKh));
        witnessSet.set_native_scripts(nativeScripts);


        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }

    static async mint(protocolParams, utxosForFee, utxoForCollateral, adminPubKh, to, tokenName, amount, ttl, signFn) {

        const txBuilder = utils.initTxBuilder(protocolParams);
        let changeAddr;

        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            changeAddr = from;
            txBuilder.add_regular_input(from, input, value);
        }

        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            txCollateralInputBuilder.add_regular_input(from, input, value);
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        const mintBuilder = CardanoWasm.MintBuilder.new();
        let mint_witnes = CardanoWasm.MintWitness.new_native_script(CardanoWasm.NativeScriptSource.new(FakeToken.script(adminPubKh)));
        const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName));
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('' + amount));

        const toAddr = CardanoWasm.Address.from_bech32(to);
        const scriptHash = FakeToken.script(adminPubKh).hash();
        const tokenId = scriptHash.to_hex() + '.' + assetName.to_hex();
        const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [tokenId]: amount } });
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('' + amount));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken), mutiAsset);
        const outputOfMint = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);
        txBuilder.add_output(outputOfMint);


        txBuilder.set_mint_builder(mintBuilder);
        const slightMinFee = txBuilder.min_fee();
        txBuilder.set_total_collateral_and_return(slightMinFee.checked_mul(CardanoWasm.BigNum.from_str('2')), changeAddr);
        //====================================================================================

        if (ttl) txBuilder.set_ttl(ttl);
        // txBuilder.add_required_signer( CardanoWasm.Ed25519KeyHash.from_hex(adminPubKh));
        txBuilder.add_change_if_needed(changeAddr);

        let tx = txBuilder.build_tx();
        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());
        // console.log('--->', CardanoWasm.PublicKey.from_bech32(signResult.vkey).hash().to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);
        // vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);
        const nativeScripts = CardanoWasm.NativeScripts.new();
        nativeScripts.add(FakeToken.script(adminPubKh));
        witnessSet.set_native_scripts(nativeScripts);


        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }

    static async transfer(utxosForFee, to, funValue, datum) {
        const txBuilder = utils.initTxBuilder(protocolParams);
        let changeAddr;

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            changeAddr = from;
            txInputBuilder.add_regular_input(from, input, value);
        }

        const toAddr = CardanoWasm.Address.from_bech32(to);
        const outputValue = utils.funValue(funValue);
        const output = CardanoWasm.TransactionOutput.new(toAddr, outputValue);
        output.set_plutus_data(datum);
        txBuilder.add_output(output);

        if (ttl) txBuilder.set_ttl(ttl);
        // txBuilder.add_required_signer()
        txBuilder.add_change_if_needed(changeAddr);

        let tx = txBuilder.build_tx();

        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnesses.add(vkeyWitness);

        const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        witnessSet.set_vkeys(vkeyWitnesses);

        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }
}

let Network_Id = 1
function init(network = true) {
    contractMgr.init(network);
    nftContracts.init(network);
    msgContracts.init(network);
    const currentPlutus = network ? plutus.mainnet : plutus.testnet;
    Network_Id = network ? 1 : 0;

    // groupInfoTokenPlutus = currentPlutus.groupInfoTokenPlutus;
    // groupInfoTokenHolderPlutus = currentPlutus.groupInfoTokenHolderPlutus;
    const treasuryPlutus = currentPlutus.treasuryPlutus;
    const treasuryCheckPlutus = currentPlutus.treasuryCheckPlutus;
    const mappingTokenPlutus = currentPlutus.mappingTokenPlutus;
    const mintCheckPlutus = currentPlutus.mintCheckPlutus;
    // const checkTokenPlutus = currentPlutus.checkTokenPlutus;

    const treasuryCheckTokenPlutus = currentPlutus.treasuryCheckTokenPlutus;
    const mintCheckTokenPlutus = currentPlutus.mintCheckTokenPlutus;

    // if(treasuryScript) treasuryScript.free();
    // if(treasuryCheckScript) treasuryCheckScript.free();
    // if(mappingTokenScript) mappingTokenScript.free();
    // if(mintCheckScript) mintCheckScript.free();

    // if(treasuryCheckTokenScript) treasuryCheckTokenScript.free();
    // if(mintCheckTokenScript) mintCheckTokenScript.free();

    treasuryScript = utils.plutusScriptFromPlutusObj(treasuryPlutus);
    treasuryCheckScript = utils.plutusScriptFromPlutusObj(treasuryCheckPlutus);
    mappingTokenScript = utils.plutusScriptFromPlutusObj(mappingTokenPlutus);
    mintCheckScript = utils.plutusScriptFromPlutusObj(mintCheckPlutus);


    treasuryCheckTokenScript = utils.plutusScriptFromPlutusObj(treasuryCheckTokenPlutus);
    mintCheckTokenScript = utils.plutusScriptFromPlutusObj(mintCheckTokenPlutus);
    // console.log("treasuryScript:",treasuryScript.hash().to_hex());
    // console.log("treasuryCheckScript:",treasuryCheckScript.hash().to_hex());
    // console.log("mappingTokenScript:",mappingTokenScript.hash().to_hex());
    // console.log("mintCheckScript:",mintCheckScript.hash().to_hex());

    MAPPINGTOKEN_POLICY = mappingTokenScript.hash().to_hex();
    // console.log(`MAPPINGTOKEN_POLICY = ${MAPPINGTOKEN_POLICY}`);
}



module.exports = {
    init,
    // GroupInfoNFTHolderScript,
    // GroupInfoTokenName,
    // AdminNFTName,
    // GroupNFT,
    TreasuryScript,
    // CheckTokenScript: CheckTokenScriptBase,
    TreasuryCheckTokenScript,
    MintCheckTokenScript,
    MappingTokenScript,
    MintCheckScript,
    TreasuryCheckScript,
    FakeToken
}