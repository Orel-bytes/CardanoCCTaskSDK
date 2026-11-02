const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const jsSHA = require("jssha");
const utils = require('./utils');
const BigNumber = require('bignumber.js');

const plutus = require('./plutus');

const plutusdata = require('./plutusdata');
const { init_ogmios } = require('./ogmios-utils');
let Network_Id = 1;
const contractMgr = require('./contracts-mgr');
const cbor = require('cbor-sync');

let nftTreasuryScript;
let nftTreasuryCheckScript;
let nftMappingTokenScript;
let nftMintCheckScript;
let nftTreasuryCheckTokenScript;
let nftMintCheckTokenScript;
let nftRefHolderScript;


const PRD = true;
function getCostModels(protocolParams) {
    if (PRD) {
        return protocolParams.costModels;
    } else {
        return CardanoWasm.TxBuilderConstants.plutus_conway_cost_models();
    }
}
class NFTRefHolderScript {
    static script() {
        return nftRefHolderScript;
    }

    static address(stake_cred = undefined) {

        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(NFTRefHolderScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(NFTRefHolderScript.script().hash())).to_address();
        }
    }
}

class NFTTreasuryScript {

    static MODE_ECDSA = 0;
    static MODE_SCHNORR340 = 1;
    static MODE_ED25519 = 2;

    static CROSSTX = 0;
    static BALANCETX = 1;
    static MANUALTX = 2;

    static script() {
        return nftTreasuryScript;
    }

    static address(stake_cred = undefined) {

        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(NFTTreasuryScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(NFTTreasuryScript.script().hash())).to_address();
        }
    }


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

        let perValue = { coins: funValue.coins ? Math.ceil(funValue.coins / outputCount) : 0, assets: {} };

        for (const tokenId in funValue.assets) {
            perValue.assets[tokenId] = Math.ceil(funValue.assets[tokenId] * 1 / outputCount);
        }
        const minPerValue = utils.getMinAdaOfUtxo(protocolParams, changeAddress, perValue, utils.genDemoDatum42());
        if (minPerValue > perValue.coins) perValue.coins = minPerValue;

        // const minAda = utils.getMinAdaOfUtxo(protocolParams,NFTTreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]),funValue,utils.genDemoDatum42());
        // if(minAda > perValue.coins*1) perValue.coins = minAda;

        const perValueOfOutput = utils.funValue(perValue);
        const multiAsset = CardanoWasm.MultiAsset.new();
        for (const tokenId in funValue.assets) {
            const [policy_id, tokenName] = tokenId.split('.');
            const assets = CardanoWasm.Assets.new();
            assets.insert(CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex')), CardanoWasm.BigNum.from_str('' + Math.ceil(funValue.assets[tokenId] / outputCount)));
            multiAsset.insert(CardanoWasm.ScriptHash.from_hex(policy_id), assets)
            // perValueOfOutput.assets[tokenId] = funValue.assets[tokenId]/outputCount;
            perValueOfOutput.set_multiasset(multiAsset);
        }

        // console.log(NFTTreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]).to_bech32('addr_test'));
        const minada = utils.getMinAdaOfUtxo(protocolParams, NFTTreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), perValueOfOutput, utils.genDemoDatum42());
        if (perValueOfOutput.coin().to_str() * 1 < minada) {
            perValueOfOutput.set_coin(CardanoWasm.BigNum.from_str('' + minada));
        }
        for (let i = 0; i < outputCount; i++) {
            const output = CardanoWasm.TransactionOutput.new(NFTTreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh]), perValueOfOutput);
            let datum = utils.genDemoDatum42();
            output.set_plutus_data(datum);
            txBuilder.add_output(output);
        }


        txBuilder.set_inputs(txInputBuilder);


        // txBuilder.add_json_metadatum()
        // CardanoWasm.MetadataJsonSchema.
        if (rawMetaData) {
            // txBuilder.set_auxiliary_data(rawMetaData);
            NFTTreasuryScript.setMetaData(txBuilder, rawMetaData);
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


    static async transferFromTreasury(protocolParams, utxosForFee, utxosToSpend, scriptRefUtxo, groupNFTUtxo, redeemProof, utxoForCollateral, treasuryCheckUxto, treasuryCheckRef, changeAddress, evaluateFn, signFn, rawMetaData, ttl) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        const isTreasury = utils.addressToPkhOrScriptHash(redeemProof.to) == NFTTreasuryScript.script().hash().to_hex();
        // if (isTreasury) throw "to cann't be nfttreasury when cross chain";//COPY:1
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
            // console.log('utxosForFee:',utxoForFee.value)
        }
        // console.log('treasuryCheckUxto:', treasuryCheckUxto.value)

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
            // console.log('collateral:', txCollateralInputBuilder.total_value().to_json());
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        const spendInputs = CardanoWasm.TxInputsBuilder.new();

        const redeemerData = NFTTreasuryCheckScript.genCrossRedeemer(redeemProof);//COPY:2
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

        let totalScriptSize = 0;

        const treasuryCheckAddress = CardanoWasm.Address.from_bech32(treasuryCheckUxto.address);
        const treasuryCheckScriptHash = CardanoWasm.ScriptHash.from_hex(utils.addressToPkhOrScriptHash(treasuryCheckUxto.address));
        {
            const utxoToSpend = treasuryCheckUxto;
            // txBuilder.add_script_input
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);

            let ex_unit_mem = 9142333;//  4142333
            let ex_unit_cpu = 1447050275;// 1447050275

            // console.log('mem:', ex_unit_mem, 'cpu:', ex_unit_cpu);
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str((ex_unit_mem) + ''),
                CardanoWasm.BigNum.from_str((ex_unit_cpu) + '')
            );
            total_ex_mem += ex_unit_mem;
            total_ex_cpu += ex_unit_cpu;

            const redeemer = CardanoWasm.Redeemer.new(CardanoWasm.RedeemerTag.new_spend(), CardanoWasm.BigNum.from_str('0'), redeemerData, exUnits);

            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(treasuryCheckRef);
            totalScriptSize += scriptSize;

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

        for (let i = 0; i < utxosToSpend.length; i++) {
            // console.log('utxosToSpend[',i,']:', utxosToSpend[i].value)
            const utxoToSpend = utxosToSpend[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);
            const from = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            let ex_unit_mem = 4211410;//EX_UINT_MEM_ONLY_ONE; 2211410
            let ex_unit_cpu = 663013608;//EX_UINT_CPU_ONLY_ONE; 663013608

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
            totalScriptSize += scriptSize;

            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(CardanoWasm.PlutusScriptSource.new_ref_input(
                scriptTmp.hash(), refenceInput, scriptTmp.language_version(), scriptSize)
                , redeemer);
            // const witness = CardanoWasm.PlutusWitness.new(NFTTreasuryScript.script(),datum42,redeemer);
            txInputBuilder.add_plutus_script_input(witness, input, value);
            spendInputs.add_plutus_script_input(witness, input, value);
        }
        // console.log('total_mem:', total_ex_mem, 'total_cpu:', total_ex_cpu);
        txBuilder.set_inputs(txInputBuilder);

        //COPY:3
        let transferValue = redeemProof.crossValue;//{ coins: redeemProof.adaAmount, assets: redeemProof.tokenId ? { [redeemProof.tokenId]: redeemProof.amount } : {} };

        const outputValue = utils.funValue(transferValue);//COPY:4
        // console.log(spendInputs.total_value().to_json(), outputValue.to_json());
        let valueOutputOfTreasury = spendInputs.total_value().checked_sub(outputValue);
        // console.log(valueOutputOfTreasury.to_json());

        let datumTmp = redeemProof.userData ? CardanoWasm.PlutusData.from_hex(redeemProof.userData) : undefined;
        if (isTreasury) datumTmp = datum42;

        let minAdaOfTransferOutput = utils.getMinAdaOfUtxo(protocolParams, redeemProof.to, transferValue, datumTmp);
        if (outputValue.coin().to_str() * 1 < minAdaOfTransferOutput * 1) outputValue.set_coin(CardanoWasm.BigNum.from_str(minAdaOfTransferOutput + ''));//COPY:5

        const treasuryAddress = NFTTreasuryScript.address(groupInfo[contractMgr.GroupNFT.StkVh])

        // if (valueOutputOfTreasury.multiasset() && valueOutputOfTreasury.multiasset().len() > 0) {//Just spend all input of treasury


        let output = CardanoWasm.TransactionOutput.new(CardanoWasm.Address.from_bech32(redeemProof.to), outputValue);
        if (utils.addressType(redeemProof.to) == CardanoWasm.CredKind.Script) {
            if (isTreasury)
                output.set_plutus_data(datum42);
            else {
                if (redeemProof.userData.datumType == plutusdata.DATUMTYP_DATUM) {
                    output.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData.datumOrHash));
                }
                if (redeemProof.userData.datumType == plutusdata.DATUMTYP_HASH) {
                    output.set_data_hash(CardanoWasm.DataHash.from_hex(redeemProof.userData.datumOrHash));
                }
            }
        }
        txBuilder.add_output(output); // The index of the output to toAddress must be 1. this is a agment sdk requirment.

        if (!valueOutputOfTreasury.is_zero()) {
            let minAdaOfChange = utils.getMinAdaOfUtxo(protocolParams, treasuryAddress, valueOutputOfTreasury, datum42);
            if (valueOutputOfTreasury.coin().to_str() * 1 < minAdaOfChange * 1)
                valueOutputOfTreasury.set_coin(CardanoWasm.BigNum.from_str(minAdaOfChange + ''));
            let treasuryChangeOutput = CardanoWasm.TransactionOutput.new(treasuryAddress, valueOutputOfTreasury);
            treasuryChangeOutput.set_plutus_data(datum42);
            txBuilder.add_output(treasuryChangeOutput);
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


        if (redeemProof.txType == NFTTreasuryScript.BALANCETX) {
            txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(groupInfo[contractMgr.GroupNFT.BalanceWorker]));
        }

        const minFee = txBuilder.min_fee();
        // console.log('minFee:', minFee.to_str());
        txBuilder.set_total_collateral_and_return(minFee.checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);
        if (rawMetaData) {
            // txBuilder.set_auxiliary_data(rawMetaData);
            NFTTreasuryScript.setMetaData(txBuilder, rawMetaData);
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
        const draftTx = CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
        // console.log('======', draftTx.to_json());
        const costModlstmp = CardanoWasm.Costmdls.new();
        costModlstmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        return utils.fixTxExuintByEvaluate(protocolParams, costModlstmp, draftTx.to_hex(), totalScriptSize, evaluateFn, signFn);
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

class NFTTreasuryCheckScript {
    // constructor(scriptCbor) {
    //     this.nftTreasuryCheckScript = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(scriptCbor, 'hex'));
    // }

    static script() {
        return nftTreasuryCheckScript;
    }

    static address(stake_cred = undefined) {
        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(NFTTreasuryCheckScript.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(NFTTreasuryCheckScript.script().hash())).to_address();
        }
    }

    static __proofData(proof) {
        const ls = CardanoWasm.PlutusList.new();

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.uniqueId, 'hex')));
        ls.add(plutusdata.toPlutusDataTxOutRef(proof.txHash, proof.index));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.mode + '')));
        ls.add(plutusdata.toPlutusDataAddress(proof.to));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.policy_id, 'hex')));
        ls.add(plutusdata.toPlutusDataValue(proof.crossValue));
        if (!proof.userData) ls.add(plutusdata.toPlutusDataOutputDatum(plutusdata.DATUMTYP_NO, ''));
        else ls.add(plutusdata.toPlutusDataOutputDatum(proof.userData.datumType, proof.userData.datumOrHash));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.txType + '')));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.ttl + '')));


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
                return this.__getCrossProofFromCBOR(redeemerHex);
                break;
            }
            case '2': {
                throw 'bad cross redeemer data';
            }
            default:
                throw 'bad cross redeemer data';
        }

    }

    static __getCrossProofFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const wrappedLs = redeemer.as_constr_plutus_data().data();
        const ls = wrappedLs.get(0).as_constr_plutus_data().data();
        // console.log('len: ',ls.len(),);


        const signature = Buffer.from(ls.get(1).as_bytes()).toString('hex');
        const proofCbor = ls.get(0).as_constr_plutus_data().data();

        const uniqueId = Buffer.from(proofCbor.get(0).as_bytes()).toString('hex');

        const { txHash, index } = plutusdata.txOutRefFromCbor(proofCbor.get(1).as_constr_plutus_data().to_hex());
        const mode = proofCbor.get(2).as_integer().as_int().as_i32();
        const to = plutusdata.addressFromCbor(proofCbor.get(3).as_constr_plutus_data().to_hex(), Network_Id);
        const policy = Buffer.from(proofCbor.get(4).as_bytes()).toString('hex');
        const crossValue = plutusdata.valueFromCbor(proofCbor.get(5).as_map().to_hex());
        let userData = plutusdata.outputDatumFromCbor(proofCbor.get(6).as_constr_plutus_data().to_hex());
        // if(userData) userData = Buffer.from(userData.get(0).as_bytes()).toString('hex');
        const txType = proofCbor.get(7).as_integer().as_int().as_i32();
        const ttl = proofCbor.get(8).as_integer().as_int().as_i32();

        return { uniqueId, txHash, index, mode, to, policy, crossValue, userData: userData, txType, ttl, signature };
    }

    static genBurnRedeemerData() {
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                CardanoWasm.PlutusList.new()
            )
        )
    }

    static __genNFTTreasuryCheckProof(proof) {
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.__proofData(proof));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }

    static genCrossRedeemer(proof) {
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.__genNFTTreasuryCheckProof(proof));
        // ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('1'),
                ls
            )
        )
    }

    // static genMegerRedeemerData(policy_id) {
    //     const ls = CardanoWasm.PlutusList.new();
    //     ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(policy_id, 'hex')));

    //     return CardanoWasm.PlutusData.new_constr_plutus_data(
    //         CardanoWasm.ConstrPlutusData.new(
    //             CardanoWasm.BigNum.from_str('1'),
    //             ls
    //         )
    //     )
    // }

    static async burn(protocolParams, utxosForFee, utxoForCollateral, utxosSpend, scriptRef, checkTokenScriptRef, groupInfoUtxo, adminNftInfo, changeAddress, signFn, exUnitTx) {
        dd
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
            CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash()
                , checkTokenScriptRefInput, scriptTmp.language_version(), scriptSize)
            , redeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(NFTTreasuryCheckTokenScript.tokenName()));
        // console.log(assetName.to_json());
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
                CardanoWasm.PlutusScriptSource.new_ref_input(CardanoWasm.ScriptHash.from_hex(scriptHash)
                    , scriptRefInput, scriptTmp.language_version(), scriptSize)
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




class NFTMappingTokenScript {

    constructor(scriptCbor) {
        // this.nftMappingTokenScript = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(scriptCbor, 'hex'));
    }

    static script() {
        // return this.nftMappingTokenScript;
        return nftMappingTokenScript
    }

    static policy_id() {
        // return this.nftMappingTokenScript.hash().to_hex();
        return nftMappingTokenScript.hash().to_hex();
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

    static async burn(protocolParams, utxosForFee, utxoForCollateral, scriptRef, utxosToBurn, burnValue, changeAddress, evaluateFn, signFn, ttl, rawMetaData) {
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

        if (rawMetaData) {
            txBuilder.set_auxiliary_data(NFTMappingTokenScript.genMetaData(rawMetaData));
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
        const costModlstmp = CardanoWasm.Costmdls.new();
        costModlstmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        return utils.fixTxExuintByEvaluate(protocolParams, costModlstmp,draftTx.to_hex(), totalScriptSize, evaluateFn, signFn);
    }

    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, mintCheckScriptRef, groupNFTUtxo, mintCheckUtxo, redeemProof, nftRefHolder, changeAddress, evaluateFn, signFn, ttl, rawMetaData) {
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

        const { script: NFTMappingTokenScriptFromCBor, scriptSize } = utils.plutusScriptFromScriptRef(scriptRef);
        totalScriptSize += scriptSize;
        const scriptHash = NFTMappingTokenScriptFromCBor.hash();
        // console.log('scriptHash:',scriptHash.to_hex());
        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );

        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(scriptHash
            , scriptRefInput, NFTMappingTokenScriptFromCBor.language_version(), scriptSize);

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
        for (let i = 0; i < redeemProof.nftAssets.length; i++) {
            const element = redeemProof.nftAssets[i];
            const assetName = CardanoWasm.AssetName.new(Buffer.from(element.name, 'hex'));
            mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('' + element.amount));
        }

        for (let i = 0; i < redeemProof.nftRefAssets.length; i++) {
            const element = redeemProof.nftRefAssets[i];
            const assetName = CardanoWasm.AssetName.new(Buffer.from(element.name, 'hex'));
            mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('1'));
        }
        // console.log(mintBuilder.get_ref_inputs().to_json());

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
        const redeemerData = NFTMintCheckScript.genCrossRedeemer(redeemProof);
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

        // const params = contractMgr.GroupNFT.groupInfoFromDatum(groupNFTUtxo.datum);
        // const requiredSigner = params[contractMgr.GroupNFT.BalanceWorker];


        const toAddr = CardanoWasm.Address.from_bech32(redeemProof.to);

        let testDatum;
        if (redeemProof.userData && redeemProof.userData.datumOrHash) {
            testDatum = CardanoWasm.PlutusData.from_hex(redeemProof.userData.datumOrHash);
        }

        const nftRefHolderAddress = CardanoWasm.Address.from_bech32(nftRefHolder);
        for (let i = 0; i < redeemProof.nftRefAssets.length; i++) {
            const element = redeemProof.nftRefAssets[i];
            // nft reference output
            const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, nftRefHolderAddress, { coins: 1000000, assets: { [policy_id + '.' + element.name]: 1 } }, CardanoWasm.PlutusData.from_hex(element.datum));
            const mutiAsset = CardanoWasm.MultiAsset.new();
            const asset = CardanoWasm.Assets.new();
            const assetName = CardanoWasm.AssetName.new(Buffer.from(element.name, 'hex'));
            asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
            mutiAsset.insert(scriptHash, asset);
            let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
            mintedValue.set_multiasset(mutiAsset);
            const outputOfRefNFT = CardanoWasm.TransactionOutput.new(nftRefHolderAddress, mintedValue);
            outputOfRefNFT.set_plutus_data(CardanoWasm.PlutusData.from_hex(element.datum));
            txBuilder.add_output(outputOfRefNFT);
        }

        {
            // nft output
            const nftAssetsValue = {};
            const mutiAsset = CardanoWasm.MultiAsset.new();
            const asset = CardanoWasm.Assets.new();
            for (let i = 0; i < redeemProof.nftAssets.length; i++) {
                const element = redeemProof.nftAssets[i];
                const assetName = CardanoWasm.AssetName.new(Buffer.from(element.name, 'hex'));
                asset.insert(assetName, CardanoWasm.BigNum.from_str('' + element.amount));
                nftAssetsValue[policy_id + '.' + element.name] = element.amount;
            }

            mutiAsset.insert(scriptHash, asset);
            const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: nftAssetsValue }, testDatum);
            let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
            mintedValue.set_multiasset(mutiAsset);
            const outputOfNFT = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);
            if (utils.addressType(redeemProof.to) == CardanoWasm.CredKind.Script && !redeemProof.userData) {
                throw 'need datum'
            }
            // sdk only supports inline datum yet
            if (redeemProof.userData) {
                // outputOfMint.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData));
                if (redeemProof.userData.datumType == plutusdata.DATUMTYP_DATUM) {
                    outputOfNFT.set_plutus_data(CardanoWasm.PlutusData.from_hex(redeemProof.userData.datumOrHash));
                }
                if (redeemProof.userData.datumType == plutusdata.DATUMTYP_HASH) {
                    outputOfNFT.set_data_hash(CardanoWasm.DataHash.from_hex(redeemProof.userData.datumOrHash));
                }
                // console.log(outputOfMint.to_json());
            }
            txBuilder.add_output(outputOfNFT);
        }

        const mintCheckUtxovalue = utils.funValue(mintCheckUtxo.value);
        const mintcheckAddress = CardanoWasm.Address.from_bech32(mintCheckUtxo.address);
        const minAdaOfMintCheckChangeUtxo = utils.getMinAdaOfUtxo(protocolParams, mintcheckAddress, mintCheckUtxovalue, utils.genDemoDatum42());
        const checkTokenAssetName = CardanoWasm.AssetName.new(Buffer.from(NFTMintCheckTokenScript.tokenName()));
        const multiAssetOfCheckToken = CardanoWasm.MultiAsset.new();
        const mintCheckTokenAsset = CardanoWasm.Assets.new();
        mintCheckTokenAsset.insert(checkTokenAssetName, CardanoWasm.BigNum.from_str('1'));
        multiAssetOfCheckToken.insert(NFTMintCheckTokenScript.script().hash(), mintCheckTokenAsset) //(checkTokenAssetName,CardanoWasm.Int.from_str('1'));
        const outputMintCheckChange = CardanoWasm.TransactionOutput.new(
            mintcheckAddress,
            CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaOfMintCheckChangeUtxo), multiAssetOfCheckToken));
        outputMintCheckChange.set_plutus_data(utils.genDemoDatum42());



        txBuilder.set_mint_builder(mintBuilder);
        txBuilder.add_reference_input(groupNFTRefInput);
        txBuilder.add_plutus_script_input(mintCheckWitness, mintCheckInput, utils.funValue(mintCheckUtxo.value));
        // txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(requiredSigner));

        txBuilder.add_output(outputMintCheckChange);

        if (rawMetaData) {
            txBuilder.set_auxiliary_data(NFTMappingTokenScript.genMetaData(rawMetaData));
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

        // return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());

        const draftTx = CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
        // console.log('======', draftTx.to_json());
        const costModlstmp = CardanoWasm.Costmdls.new();
        costModlstmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        return utils.fixTxExuintByEvaluate(protocolParams,costModlstmp, draftTx.to_hex(), totalScriptSize, evaluateFn, signFn);
        // return draftTx;
    }

}

class NFTMintCheckScript {
    static script() {
        return nftMintCheckScript;
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

    static __proofData(proof) {
        // TODO:
        const ls = CardanoWasm.PlutusList.new();

        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.uniqueId, 'hex')));
        ls.add(plutusdata.toPlutusDataTxOutRef(proof.txHash, proof.index));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.mode + '')));
        ls.add(plutusdata.toPlutusDataAddress(proof.to));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.policy_id, 'hex')));

        {
            const nftAssets = CardanoWasm.PlutusList.new();
            for (let i = 0; i < proof.nftAssets.length; i++) {
                const element = proof.nftAssets[i];
                const item = CardanoWasm.PlutusList.new();
                item.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(element.name, 'hex')));
                item.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('' + element.amount)));
                const asset = CardanoWasm.PlutusData.new_constr_plutus_data(CardanoWasm.ConstrPlutusData.new(CardanoWasm.BigNum.from_str('0'), item));
                nftAssets.add(asset);
            }
            ls.add(CardanoWasm.PlutusData.new_list(nftAssets));
        }

        if (!proof.userData) ls.add(plutusdata.toPlutusDataOutputDatum(plutusdata.DATUMTYP_NO, ''));
        else ls.add(plutusdata.toPlutusDataOutputDatum(proof.userData.datumType, proof.userData.datumOrHash));

        {
            const nftRefAssets = CardanoWasm.PlutusList.new();
            for (let i = 0; i < proof.nftRefAssets.length; i++) {
                const element = proof.nftRefAssets[i];
                const item = CardanoWasm.PlutusList.new();
                // item.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('' + element.index)));
                item.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('' + i)));
                item.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(element.name, 'hex')));
                item.add(plutusdata.toPlutusDataOutputDatum(plutusdata.DATUMTYP_DATUM, element.datum));
                const assetRef = CardanoWasm.PlutusData.new_constr_plutus_data(CardanoWasm.ConstrPlutusData.new(CardanoWasm.BigNum.from_str('0'), item));
                nftRefAssets.add(assetRef);
            }
            ls.add(CardanoWasm.PlutusData.new_list(nftRefAssets));
        }

        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(proof.ttl + '')));


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

    static __genNFTMintCheckProof(proof) {
        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.__proofData(proof));
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }

    static genCrossRedeemer(proof) {//{"constructor":0,"fields":[]}

        const ls = CardanoWasm.PlutusList.new();
        ls.add(this.__genNFTMintCheckProof(proof));
        // ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(proof.signature, 'hex')));

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('1'),
                ls
            )
        )
    }

    static __getMintProofFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);
        const wrappedLs = redeemer.as_constr_plutus_data().data();
        const ls = wrappedLs.get(0).as_constr_plutus_data().data();
        // console.log('len: ',ls.len(),);


        const signature = Buffer.from(ls.get(1).as_bytes()).toString('hex');
        const proofCbor = ls.get(0).as_constr_plutus_data().data();

        const uniqueId = Buffer.from(proofCbor.get(0).as_bytes()).toString('hex');

        const { txHash, index } = plutusdata.txOutRefFromCbor(proofCbor.get(1).as_constr_plutus_data().to_hex());
        const mode = proofCbor.get(2).as_integer().as_int().as_i32();
        const to = plutusdata.addressFromCbor(proofCbor.get(3).as_constr_plutus_data().to_hex(), Network_Id);
        const policy = Buffer.from(proofCbor.get(4).as_bytes()).toString('hex');

        const nftAssetsCbor = proofCbor.get(5).as_list();
        let nftAssets = [];
        for (let i = 0; i < nftAssetsCbor.len(); i++) {
            const assetCbor = nftAssetsCbor.get(i);
            const element = assetCbor.as_constr_plutus_data().data();
            const name = Buffer.from(element.get(0).as_bytes()).toString('hex');
            const amount = element.get(1).as_integer().to_str() * 1;
            nftAssets.push({ name, amount });
        }

        let userData = plutusdata.outputDatumFromCbor(proofCbor.get(6).as_constr_plutus_data().to_hex());

        const nftRefAssetsCbor = proofCbor.get(7).as_list();
        let nftRefAssets = []
        for (let i = 0; i < nftRefAssetsCbor.len(); i++) {
            const assetCbor = nftRefAssetsCbor.get(i);
            const element = assetCbor.as_constr_plutus_data().data();
            const index = element.get(0).as_integer().to_str() * 1;;
            const name = Buffer.from(element.get(1).as_bytes()).toString('hex');
            const datum = plutusdata.outputDatumFromCbor(element.get(2).to_hex());
            nftRefAssets.push({ index, name, datum });
        }

        const ttl = proofCbor.get(8).as_integer().as_int().as_i32();

        return { uniqueId, txHash, index, mode, to, policy, nftAssets, userData, nftRefAssets, ttl, signature };
    }



    static getMintRedeemerFromCBOR(redeemerHex) {
        const redeemer = CardanoWasm.PlutusData.from_hex(redeemerHex);

        const alternative = redeemer.as_constr_plutus_data().alternative().to_str();
        switch (alternative) {
            case '0': {
                // throw 'bad cross redeemer data';
                break;
            }
            case '1': {
                return this.__getMintProofFromCBOR(redeemerHex);
                break;
            }
            default:
                throw 'bad cross redeemer data';
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
            CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash(), checkTokenScriptRefInput
                , scriptTmp.language_version(), scriptSize)
            , redeemer);
        const assetName = CardanoWasm.AssetName.new(Buffer.from(NFTMintCheckTokenScript.tokenName()));
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

class NFTTreasuryCheckTokenScript extends CheckTokenScriptBase {
    static script() {
        return nftTreasuryCheckTokenScript;
    }

    static tokenName() {
        return 'NFTTCheckCoin';
    }
}

class NFTMintCheckTokenScript extends CheckTokenScriptBase {
    static script() {
        return nftMintCheckTokenScript;
    }

    static tokenName() {
        return 'NFTMCheckCoin';
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

    static tokenId(adminPubKh, tokenName) {
        return this.policy_id(adminPubKh) + '.' + Buffer.from(tokenName).toString('hex');
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
        let mint_witnes = CardanoWasm.MintWitness.new_native_script(FakeToken.script(adminPubKh));
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


function init(network = true) {

    const currentPlutus = network ? plutus.mainnet : plutus.testnet;
    Network_Id = network ? 1 : 0;


    const nftTreasuryPlutus = currentPlutus.nftTreasuryPlutus;
    const nftTreasuryCheckPlutus = currentPlutus.nftTreasuryCheckPlutus;
    const nftMappingTokenPlutus = currentPlutus.nftMappingTokenPlutus;
    const nftMintCheckPlutus = currentPlutus.nftMintCheckPlutus;
    const nftTreasuryCheckTokenPlutus = currentPlutus.nftTreasuryCheckTokenPlutus;
    const nftMintCheckTokenPlutus = currentPlutus.nftMintCheckTokenPlutus;
    const nftRefHoderPlutus = currentPlutus.nftRefHoderPlutus


    nftTreasuryScript = utils.plutusScriptFromPlutusObj(nftTreasuryPlutus);
    nftTreasuryCheckScript = utils.plutusScriptFromPlutusObj(nftTreasuryCheckPlutus);
    nftMappingTokenScript = utils.plutusScriptFromPlutusObj(nftMappingTokenPlutus);
    nftMintCheckScript = utils.plutusScriptFromPlutusObj(nftMintCheckPlutus);
    nftTreasuryCheckTokenScript = utils.plutusScriptFromPlutusObj(nftTreasuryCheckTokenPlutus);
    nftMintCheckTokenScript = utils.plutusScriptFromPlutusObj(nftMintCheckTokenPlutus);
    nftRefHolderScript = utils.plutusScriptFromPlutusObj(nftRefHoderPlutus);
}



module.exports = {
    init
    , NFTTreasuryScript
    , NFTTreasuryCheckScript
    , NFTMappingTokenScript
    , NFTMintCheckTokenScript
    , NFTTreasuryCheckTokenScript
    , NFTMintCheckScript
    , NFTRefHolderScript
}