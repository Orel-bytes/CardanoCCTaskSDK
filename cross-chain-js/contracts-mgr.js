const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const jsSHA = require("jssha");
const utils = require('./utils');
const BigNumber = require('bignumber.js');
const cbor = require('cbor-sync');
const plutus = require('./plutus');


let groupNFTScript;// = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(groupInfoTokenPlutus.cborHex, 'hex'));
let groupNFTHolderScript;// = CardanoWasm.PlutusScript.from_bytes_v2(Buffer.from(groupInfoTokenHolderPlutus.cborHex, 'hex'));
let adminNFTScript;
let adminNFTHolderScript;
let storemanStakeScript;
let stakeCheckScript;


const AdminNFTName = 'AdminNFTCoin';
const GroupInfoTokenName = 'GroupInfoTokenCoin';


const PRD = true;
function getCostModels(protocolParams) {
    if (PRD) {
        return protocolParams.costModels;
    } else {
        return CardanoWasm.TxBuilderConstants.plutus_conway_cost_models();
    }
}

class AdminNFT {

    static script() {
        return adminNFTScript;
    }

    static policy_id() {
        return this.script().hash().to_hex();
    }

    static tokenId() {
        return this.policy_id() + '.' + Buffer.from(AdminNFTName).toString('hex');
    }

    static async burn() { throw 'not implementation' }

    // mintParams:{owner:'addr_XXXX',datum:'HEX' | undefined}
    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, changeAddress, mintParams, signFn) {
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

        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );
        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(this.script().hash()
            , scriptRefInput, this.script().language_version(),this.script().bytes().byteLength);

        let ex_unit_mem = 7575293;//  4142333
        let ex_unit_cpu = 2880092692; //1447050275

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


        const assetName = CardanoWasm.AssetName.new(Buffer.from(AdminNFTName));
        // console.log(assetName.to_hex());
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('1'));




        //step3: collater input
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


        const toAddr = CardanoWasm.Address.from_bech32(mintParams.owner);

        const scriptHash = this.script().hash();
        const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [this.tokenId()]: 1 } }, mintParams.datum);
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
        mintedValue.set_multiasset(mutiAsset);
        const outputOfMint = CardanoWasm.TransactionOutput.new(toAddr, mintedValue);

        //if owner is contract ,output must has datum
        const toAddrType = utils.addressType(mintParams.owner);
        if (toAddrType == CardanoWasm.CredKind.Script) {
            outputOfMint.set_plutus_data(mintParams.datum);
        }


        txBuilder.set_mint_builder(mintBuilder);
        txBuilder.add_output(outputOfMint);


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

        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }
}

class GroupNFT {
    static Version = 0;
    static Admin = 1;
    static GPK = 2;
    static BalanceWorker = 3;
    static TreasuryCheckVH = 4;
    static OracleWorker = 5;
    static MintCheckVH = 6;
    static StkVh = 7;
    static StkCheckVh = 8;
    static NFTRefHolderVH = 9;
    static NFTTreasuryCheckVH = 10;
    static NFTMintCheckVH = 11;
    static OutboundHolderVH = 12;
    static InboundCheckVH = 13;

    static script() {
        return groupNFTScript;
    }

    static policy_id() {
        return this.script().hash().to_hex();
    }

    static tokenId() {
        return this.policy_id() + '.' + Buffer.from(GroupInfoTokenName).toString('hex');
    }

    static async burn() { throw 'not implementation' }

    static genGroupInfoDatum(groupInfoParams) {
        const ls = CardanoWasm.PlutusList.new();

        const params = CardanoWasm.PlutusList.new();
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.Version + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.Admin + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.GPK + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.BalanceWorker + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.TreasuryCheckVH + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.OracleWorker + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.MintCheckVH + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.StkVh + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.StkCheckVh + ''], 'hex')));
        // NFTRefHolderVH | NFTTreasuryCheckVH | NFTMintCheckVH
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.NFTRefHolderVH + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.NFTTreasuryCheckVH + ''], 'hex')));
        params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.NFTMintCheckVH + ''], 'hex')));
        // OutboundHolderVH | InboundCheckVH
        if(Object.keys(groupInfoParams).length == 14){
            params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.OutboundHolderVH + ''], 'hex')));
            params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.InboundCheckVH + ''], 'hex')));
        }
        // params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.OutboundHolderVH + ''], 'hex')));
        // params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(groupInfoParams[GroupNFT.InboundCheckVH + ''], 'hex')));

        ls.add(CardanoWasm.PlutusData.new_list(params));

        // CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'))
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }

    static groupInfoFromDatum(plutusDataHex) {
        const datum = CardanoWasm.PlutusData.from_hex(plutusDataHex);
        // console.log(datum.to_json());
        const parmsLs = datum.as_constr_plutus_data().data().get(0).as_list();

        let ret = {};
        for (let i = 0; i < parmsLs.len(); i++) {
            ret[i + ''] = Buffer.from(parmsLs.get(i).as_bytes()).toString('hex');
        }

        return ret;
    }

    static async mint(protocolParams, utxosForFee, utxoForCollateral, scriptRef, groupInfoParams, changeAddress, ttl, signFn){
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

        //step2: construct mint
        const mintBuilder = CardanoWasm.MintBuilder.new();
        const scriptRefInput = CardanoWasm.TransactionInput.new(
            CardanoWasm.TransactionHash.from_hex(scriptRef.txHash)
            , scriptRef.index
        );
        const mint_plutus_script_source = CardanoWasm.PlutusScriptSource.new_ref_input(this.script().hash()
            , scriptRefInput, this.script().language_version(),this.script().bytes().byteLength);

        let ex_unit_mem = 7575293;//  4142333
        let ex_unit_cpu = 2880092692; //1447050275

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


        const assetName = CardanoWasm.AssetName.new(Buffer.from(GroupInfoTokenName));
        // console.log(assetName.to_hex());
        mintBuilder.add_asset(mint_witnes, assetName, CardanoWasm.Int.from_str('1'));




        //step3: collater input
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


        // const toAddr = CardanoWasm.Address.from_bech32(mintParams.owner);

        const scriptHash = this.script().hash();
        const groupInfoDatum = GroupNFT.genGroupInfoDatum(groupInfoParams);
        const holderAddr = GroupInfoNFTHolderScript.address()
        // const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, toAddr, { coins: 1000000, assets: { [this.tokenId()]: 1 } }, mintParams.datum);
        const minAdaWithMintToken = utils.getMinAdaOfUtxo(protocolParams, holderAddr, { coins: 1, assets: { [this.tokenId()]: 1 } }, groupInfoDatum);
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);
        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithMintToken));
        mintedValue.set_multiasset(mutiAsset);
        const outputOfMint = CardanoWasm.TransactionOutput.new(holderAddr, mintedValue);
       
        outputOfMint.set_plutus_data(groupInfoDatum);


        txBuilder.set_mint_builder(mintBuilder);
        txBuilder.add_output(outputOfMint);


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

        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }

    static async mint2(protocolParams, utxosForFee, utxoForCollateral, scriptRef, groupInfoParams, changeAddress, ttl, signFn) {
        const fee = CardanoWasm.BigNum.from_str('256907');//fake fee value 255499

        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'));

        const inputs = CardanoWasm.TransactionInputs.new();
        let totalInputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            // const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            totalInputValue = totalInputValue.checked_add(value);
            inputs.add(input);
        }

        const changeAddr = CardanoWasm.Address.from_bech32(changeAddress);
        const groupInfoDatum = GroupNFT.genGroupInfoDatum(groupInfoParams);

        const scriptHash = groupNFTScript.hash();

        const assetName = CardanoWasm.AssetName.new(Buffer.from(GroupInfoTokenName));

        const mint = CardanoWasm.Mint.new_from_entry(scriptHash, CardanoWasm.MintAssets.new_from_entry(assetName, CardanoWasm.Int.new_i32(1)));

        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);

        const holderAddr = GroupInfoNFTHolderScript.address();//CardanoWasm.Address.from_bech32(holder)
        const tokenId = groupNFTHolderScript.hash().to_hex() + '.' + assetName.to_hex();
        const minAdaWithToken = utils.getMinAdaOfUtxo(protocolParams, holderAddr, { coins: 1, assets: { [tokenId]: 1 } }, groupInfoDatum);
        // console.log('utils.getMinAdaOfOutput=',utils.getMinAdaOfOutput(protocolParams,credential));

        let mintedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithToken));
        mintedValue.set_multiasset(mutiAsset);
        ;
        const output = CardanoWasm.TransactionOutput.new(holderAddr, mintedValue);
        output.set_plutus_data(groupInfoDatum);

        const outputs = CardanoWasm.TransactionOutputs.new();
        outputs.add(output);

        const changeAmount = totalInputValue
            .checked_sub(CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithToken)))
            .checked_sub(CardanoWasm.Value.new(fee));
        // console.log('changeAmount:', changeAmount.to_str());

        const changeOutPut = CardanoWasm.TransactionOutput.new(changeAddr, changeAmount);
        outputs.add(changeOutPut);

        let body = CardanoWasm.TransactionBody.new_tx_body(inputs, outputs, fee);

        let refInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(scriptRef.txHash, 'hex')), scriptRef.index);
        const refInputs = CardanoWasm.TransactionInputs.new();
        refInputs.add(refInput);
        body.set_reference_inputs(refInputs);

        if (ttl) body.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));
        body.set_mint(mint);
        const collateralInputs = CardanoWasm.TransactionInputs.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxo = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxo.index);
            collateralInputs.add(input);
        }

        body.set_collateral(collateralInputs);
        // const hashs = CardanoWasm.Ed25519KeyHashes.new();
        // hashs.add(payPrvKey.to_public().hash());

        const exUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((1403197) + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str((370405352) + '')//(EX_UNIT_B)306405352
        );

        const redeemerData = CardanoWasm.PlutusData.from_bytes(Buffer.from('d8799f182aff', 'hex'));
        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_mint(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,
            exUnits
        );
        const memPriceParams = protocolParams.prices.memory.split('/');
        const stepPriceParams = protocolParams.prices.steps.split('/');

        const exUnitPrice = CardanoWasm.ExUnitPrices.new(
            CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(memPriceParams[0]), CardanoWasm.BigNum.from_str(memPriceParams[1]))
            , CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(stepPriceParams[0]), CardanoWasm.BigNum.from_str(stepPriceParams[1])))

        const plutusCost = CardanoWasm.calculate_ex_units_ceil_cost(exUnits, exUnitPrice);
        // console.log('plutusCost=', plutusCost.to_str());//258716-74207


        const redeemers = CardanoWasm.Redeemers.new();
        redeemers.add(redeemer);

        // const costModesLib = CardanoWasm.TxBuilderConstants.plutus_vasil_cost_models();
        // // const costModesLib = protocolParams.costModels;
        const costModesLib = getCostModels(protocolParams);

        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));

        const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // const hash = CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('30e9081d1297caf2ea2eea4d0735ed3b751b3fa3422095275fa7f5887c01cdf2', 'hex'))
        // console.log('\n\nHASH ===>', Buffer.from(hash.to_bytes()).toString('hex'), '\n\n');
        // body.set_script_data_hash(CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('13bf50ca49247223b9039bf9a410e8e4783c947e8672885533133ddd86fac42c', 'hex')));
        body.set_script_data_hash(hash);

        const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSet.set_redeemers(redeemers);
        //TODO collateral change

        let txBodyHash = CardanoWasm.hash_transaction(body);
        // console.log('txHash===>', txBodyHash.to_hex());
        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        // const aa = CardanoWasm.make_vkey_witness(txBodyHash, payPrvKey);
        // console.log('aa',aa.to_json());
        vkeyWitnesses.add(CardanoWasm.make_vkey_witness(txBodyHash, payPrvKey));

        // console.log('====>',CardanoWasm.make_vkey_witness(txBodyHash, payPrvKey).to_json());

        transactionWitnessSet.set_vkeys(vkeyWitnesses);

        const signedTx = CardanoWasm.Transaction.new(
            body,
            transactionWitnessSet
        )

        const txfeeWithoutPlutus = CardanoWasm.BigNum.from_str('' + protocolParams.minFeeCoefficient).checked_mul(
            CardanoWasm.BigNum.from_str('' + signedTx.to_bytes().byteLength)
        ).checked_add(CardanoWasm.BigNum.from_str('' + protocolParams.minFeeConstant));
        // console.log('txfeeWithoutPlutus=', txfeeWithoutPlutus.to_str());

        const total_fee = plutusCost.checked_add(txfeeWithoutPlutus);
        // console.log('total-fee:',total_fee.to_str())

        const outputsNew = CardanoWasm.TransactionOutputs.new();
        outputsNew.add(output);

        const changeAmountNew = totalInputValue
            .checked_sub(CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + minAdaWithToken)))
            .checked_sub(CardanoWasm.Value.new(total_fee));

        const changeOutPutNew = CardanoWasm.TransactionOutput.new(changeAddr, changeAmountNew);
        outputsNew.add(changeOutPutNew);
        let bodyNew = CardanoWasm.TransactionBody.new_tx_body(inputs, outputsNew, total_fee);
        bodyNew.set_reference_inputs(refInputs);
        bodyNew.set_mint(mint);
        bodyNew.set_collateral(collateralInputs);
        bodyNew.set_script_data_hash(hash);
        if (ttl) bodyNew.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        const transactionWitnessSetNew = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSetNew.set_redeemers(redeemers);


        const txBodyHashNew = CardanoWasm.hash_transaction(bodyNew);
        const signResult = await signFn(txBodyHashNew.to_hex());
        const vkeyWitnessesNew = CardanoWasm.Vkeywitnesses.new();
        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        vkeyWitnessesNew.add(vkeyWitness);

        transactionWitnessSetNew.set_vkeys(vkeyWitnessesNew);

        return CardanoWasm.Transaction.new(bodyNew, transactionWitnessSetNew);
    }
}

class GroupInfoNFTHolderScript {
    static script() {
        return groupNFTHolderScript;
    }

    static address() {
        return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(GroupInfoNFTHolderScript.script().hash())).to_address();
    }

    static genRedeemer(action) {
        const data = CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(action + ''));
        // const ls = CardanoWasm.PlutusList.new();

        // return CardanoWasm.PlutusData.new_constr_plutus_data(
        //     CardanoWasm.ConstrPlutusData.new(
        //         CardanoWasm.BigNum.from_str('' + action),
        //         ls
        //     )
        // )
        // console.log(data.to_json());
        return data;
    }

    static async setVersion(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newVersion, newDatum, changeAddress, ttl, signFn, exUnitTx) {

        let paramsOld = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        const param = GroupNFT.groupInfoFromDatum(newDatum.to_hex());
        paramsOld[GroupNFT.Version] = newVersion;
        for (const key in paramsOld) {
            if (paramsOld[key] == param[key]) continue;
            else {
                throw 'bad new datum';
            }
        }

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, newDatum, changeAddress, ttl, signFn, GroupNFT.Version, adminInfo, exUnitTx, exUnitTx);
    }

    // static async updateAdmin(protocolParams, utxosForFee, utxoForCollateral, utxosToSpend, scriptRef, adminInfo, newAdmin, changeAddress, ttl, signFn) {

    //     let params = GroupNFT.groupInfoFromDatum(utxosToSpend[0].datum);
    //     params[GroupNFT.Admin] = newAdmin;

    //     return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, adminInfo, utxosToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.Admin, adminInfo);
    // }

    static async switchGroup(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newGpk, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        params[GroupNFT.GPK] = newGpk;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.GPK, adminInfo, exUnitTx);

    }

    static async setBalanceWorker(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newBalanceWorkerPK, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        params[GroupNFT.BalanceWorker] = newBalanceWorkerPK;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.BalanceWorker, adminInfo, exUnitTx);


    }

    static async setTreasuryCheckVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newTreasuryCheckVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        params[GroupNFT.TreasuryCheckVH] = newTreasuryCheckVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.TreasuryCheckVH, adminInfo, exUnitTx);

    }

    static async setMintCheckVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newMintCheckVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        params[GroupNFT.MintCheckVH] = newMintCheckVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.MintCheckVH, adminInfo, exUnitTx);

    }

    static async setStakeVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newStakeVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        params[GroupNFT.StkVh] = newStakeVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.StkVh, adminInfo, exUnitTx);

    }

    static async setStakeCheckVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newStakeCheckVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        if (params.length == GroupNFT.StkCheckVh) {
            params.push(newStakeCheckVH);
        }
        params[GroupNFT.StkCheckVh] = newStakeCheckVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.StkCheckVh, adminInfo, exUnitTx);

    }

    static async setNFTRefHolderVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newNFTRefHolderVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        if (params.length == GroupNFT.NFTRefHolderVH) {
            params.push(newNFTRefHolderVH);
        }
        params[GroupNFT.NFTRefHolderVH] = newNFTRefHolderVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.NFTRefHolderVH, adminInfo, exUnitTx);

    }

    static async setNFTTreasuryCheckVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newParam, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        if (params.length == GroupNFT.NFTTreasuryCheckVH) {
            params.push(newParam);
        }
        params[GroupNFT.NFTTreasuryCheckVH] = newParam;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.NFTTreasuryCheckVH, adminInfo, exUnitTx);

    }

    static async setNFTMintCheckVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newParam, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        if (params.length == GroupNFT.NFTMintCheckVH) {
            params.push(newParam);
        }
        params[GroupNFT.NFTMintCheckVH] = newParam;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.NFTMintCheckVH, adminInfo, exUnitTx);

    }

    static async setOutboundTokenHolderVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newOutboundTokenHolderVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        if (params.length == GroupNFT.OutboundHolderVH) {
            params.push(newOutboundTokenHolderVH);
        }
        params[GroupNFT.OutboundHolderVH] = newOutboundTokenHolderVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.OutboundHolderVH, adminInfo, exUnitTx);

    }

    static async setInboundCheckVH(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newInboundCheckVH, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        if (params.length == GroupNFT.InboundCheckVH) {
            params.push(newInboundCheckVH);
        }
        params[GroupNFT.InboundCheckVH] = newInboundCheckVH;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.InboundCheckVH, adminInfo, exUnitTx);

    }

    static async setOracleWorker(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, adminInfo, newOracleWorker, changeAddress, ttl, signFn, exUnitTx) {
        // const datum = CardanoWasm.PlutusData.from_hex(utxosToSpend[0].datum);
        let params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);
        params[GroupNFT.OracleWorker] = newOracleWorker;

        return await GroupInfoNFTHolderScript.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, params, changeAddress, ttl, signFn, GroupNFT.OracleWorker, adminInfo, exUnitTx);

    }


    static async validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, groupInfoParams, changeAddress, ttl, signFn, action
        , adminInfo = { forceAdmin: false, adminNftUtxo: undefined, adminNftHoldRefScript: undefined, mustSignBy: undefined }, exUnitTx) {//forceAdmin = false

        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            inputs_arr.push(utxosForFee[i].txHash + '#' + utxosForFee[i].index);
        }
        inputs_arr.push(utxoToSpend.txHash + '#' + utxoToSpend.index);
        if (action != GroupNFT.GPK || adminInfo.forceAdmin) {
            inputs_arr.push(adminInfo.adminNftUtxo.txHash + '#' + adminInfo.adminNftUtxo.index);
        }
        inputs_arr.sort();

        const txBuilder = utils.initTxBuilder(protocolParams);

        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
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
            txCollateralInputBuilder.add_regular_input(from, input, value);
            collaterOwnerAddress = from;
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        //memory":1542362,"steps":447540637
        const redeemerData = GroupInfoNFTHolderScript.genRedeemer(action);
        let exUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str((5019790) + ''),//(EX_UNIT_A),//TODO----->1854897
            CardanoWasm.BigNum.from_str((1417257508) + '')//(EX_UNIT_B)306405352 530107903
        );
        if (exUnitTx) {
            const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(exUnitTx['spend:' + index].memory + ''),
                CardanoWasm.BigNum.from_str(exUnitTx['spend:' + index].steps + '')
            );
        }

        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_spend(),
            CardanoWasm.BigNum.from_str('0'),
            redeemerData,//CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')),
            exUnits
        );



        let groupInfoDatum;
        let groupNFTHolderPKH;
        if (action == GroupNFT.Version) {
            groupInfoDatum = groupInfoParams;
            const param = GroupNFT.groupInfoFromDatum(groupInfoParams.to_hex());
            groupNFTHolderPKH = param[GroupNFT.Version];
        } else {
            groupInfoDatum = GroupNFT.genGroupInfoDatum(groupInfoParams);
            groupNFTHolderPKH = groupInfoParams[GroupNFT.Version];
        }

        let adminPKHForSign;

        {
            // const utxoToSpend = utxosToSpend[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoToSpend.value + ''));
            const value = utils.funValue(utxoToSpend.value);
            // const from = CardanoWasm.Address.(utxoToSpend.address);
            const scriptRefInput = CardanoWasm.TransactionInput.new(
                CardanoWasm.TransactionHash.from_bytes(Buffer.from(scriptRef.txHash, 'hex')),
                scriptRef.index
            )
            // const plutusWitness = CardanoWasm.PlutusWitness.new_with_ref(PlutusScriptSource.new(myContract), DatumSource.new_ref_input(txIn), myRedeemer);
            const params = GroupNFT.groupInfoFromDatum(utxoToSpend.datum);

            if (action == GroupNFT.GPK && !adminInfo.forceAdmin) {
                adminPKHForSign = params[GroupNFT.OracleWorker];
            }
            const witness = CardanoWasm.PlutusWitness.new_with_ref(
                CardanoWasm.PlutusScriptSource.new_ref_input(GroupInfoNFTHolderScript.script().hash(), scriptRefInput, GroupInfoNFTHolderScript.script().language_version(),GroupInfoNFTHolderScript.script().bytes().byteLength*1)
                , CardanoWasm.DatumSource.new_ref_input(input)
                , redeemer);

            txInputBuilder.add_plutus_script_input(witness, input, value);
        }


        // console.log('input to spend:', txInputBuilder.inputs().to_json());
        if (ttl) txBuilder.set_ttl(ttl);


        const tokenId = groupNFTHolderScript.hash().to_hex() + '.' + Buffer.from(GroupInfoTokenName).toString('hex');
        const minAdaWithToken = utils.getMinAdaOfUtxo(protocolParams, GroupInfoNFTHolderScript.address(), { coins: 1, assets: { [tokenId]: 1 } }, groupInfoDatum);

        const scriptHash = groupNFTScript.hash();
        const assetName = CardanoWasm.AssetName.new(Buffer.from(GroupInfoTokenName));
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);

        const outputValue = CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + (minAdaWithToken+0)), mutiAsset);
        let outputAddress = GroupInfoNFTHolderScript.address();
        if (action == GroupNFT.Version) {
            outputAddress = CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(
                CardanoWasm.ScriptHash.from_hex(groupNFTHolderPKH))).to_address();
        }
        const output = CardanoWasm.TransactionOutput.new(outputAddress, outputValue);
        output.set_plutus_data(groupInfoDatum);

        txBuilder.add_output(output);

        if (!adminPKHForSign) {
            let exUintEVA;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(adminInfo.adminNftUtxo.txHash + '#' + adminInfo.adminNftUtxo.index);
                exUintEVA = exUnitTx['spend:' + index];
            }
            AdminNFTHolderScript.usingAdminNft(protocolParams, txBuilder, txInputBuilder, adminInfo.adminNftUtxo, adminInfo.adminNftHoldRefScript, adminInfo.mustSignBy, exUintEVA);
        } else {
            txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(adminPKHForSign));
        }
        txBuilder.set_inputs(txInputBuilder);
        // console.log(CardanoWasm.Ed25519KeyHash.from_hex(adminPKHForSign).to_hex());

        // const costModesLib = CardanoWasm.TxBuilderConstants.plutus_vasil_cost_models();
        // // const costModesLib = protocolParams.costModels;
        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);
        // txBuilder.set_script_data_hash(CardanoWasm.ScriptDataHash.from_hex('b1cd410aed7aa533596e7dc9b14838f3c858879ee5d3910d6fd419226248d25e'));

        const tmp = CardanoWasm.Costmdls.new();
        if(GroupInfoNFTHolderScript.script().language_version().kind() == 1){
            tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        }
        if(GroupInfoNFTHolderScript.script().language_version().kind() == 2){
            tmp.insert(CardanoWasm.Language.new_plutus_v3(), costModesLib.get(CardanoWasm.Language.new_plutus_v3()));
        }
        const redeemers = CardanoWasm.Redeemers.new();
        const datumList = CardanoWasm.PlutusList.new();
        datumList.add(groupInfoDatum);
        redeemers.add(redeemer);
        const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // txBuilder.set_script_data_hash(hash);

        const minFee = txBuilder.min_fee();
        // console.log('minFee:', minFee.to_str());
        txBuilder.set_total_collateral_and_return(minFee.checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);

        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));
        const minFee2 = txBuilder.min_fee();
        // console.log('minFee:', minFee2.to_str());


        let tx = txBuilder.build_tx();
        // console.log('script_data_hash:', tx.body().script_data_hash().to_hex());

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

        {
            let inputs = CardanoWasm.TransactionInputs.new();
            let inputArr = [];
            for (let i = 0; i < tx.body().inputs().len(); i++) {
                inputArr.push(tx.body().inputs().get(i));
            }
            inputArr.sort((a, b) => {
                const hashA = a.transaction_id().to_hex() + a.index();
                const hashB = b.transaction_id().to_hex() + b.index();
                return hashA.localeCompare(hashB);
            })
            for (let i = 0; i < inputArr.length; i++) {
                inputs.add(inputArr[i]);
            }
            // console.log('before sorting:', tx.to_json());
            const newBody = CardanoWasm.TransactionBody.new(
                inputs, tx.body().outputs(), tx.body().fee(), tx.body().ttl()
            );
            if (tx.body().auxiliary_data_hash()) newBody.set_auxiliary_data_hash(tx.body().auxiliary_data_hash());
            if (tx.body().certs()) newBody.set_certs(tx.body().certs());
            if (tx.body().collateral()) newBody.set_collateral(tx.body().collateral());
            if (tx.body().collateral_return()) newBody.set_collateral_return(tx.body().collateral_return());
            if (tx.body().mint()) newBody.set_mint(tx.body().mint());
            // if(tx.body().multiassets()) newBody.set(tx.body().multiassets());
            if (tx.body().network_id()) newBody.set_network_id(tx.body().network_id());
            if (tx.body().reference_inputs()) newBody.set_reference_inputs(tx.body().reference_inputs());
            if (tx.body().required_signers()) newBody.set_required_signers(tx.body().required_signers());
            if (tx.body().script_data_hash()) newBody.set_script_data_hash(tx.body().script_data_hash());
            if (tx.body().total_collateral()) newBody.set_total_collateral(tx.body().total_collateral());
            if (tx.body().update()) newBody.set_update(tx.body().update());
            if (tx.body().validity_start_interval()) newBody.set_validity_start_interval(tx.body().validity_start_interval());
            if (tx.body().validity_start_interval_bignum()) newBody.set_validity_start_interval_bignum(tx.body().validity_start_interval_bignum());
            if (tx.body().withdrawals()) newBody.set_withdrawals(tx.body().withdrawals());


            if (tx.body().current_treasury_value()) newBody.set_current_treasury_value(tx.body().current_treasury_value());
            if (tx.body().donation()) newBody.set_donation(tx.body().donation());
            if (tx.body().voting_procedures()) newBody.set_voting_procedures(tx.body().voting_procedures());
            if (tx.body().voting_proposals()) newBody.set_voting_procedures(tx.body().voting_proposals());
            return CardanoWasm.Transaction.new(newBody, witnessSet);
        }
        return CardanoWasm.Transaction.new(tx.body(), witnessSet);
    }
}

class AdminNFTHolderScript {

    static Use = 0;
    static Update = 1;
    static Upgrade = 2;

    static script() {
        return adminNFTHolderScript;
    }

    static address(stake_cred = undefined) {
        if (stake_cred) {
            return CardanoWasm.BaseAddress.new(Network_Id
                , CardanoWasm.Credential.from_scripthash(this.script().hash())
                , CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_hex(stake_cred))).to_address();
        } else {
            return CardanoWasm.EnterpriseAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(this.script().hash())).to_address();
        }
    }

    static genDatum(signatories, minNumSignatures) {
        const ls = CardanoWasm.PlutusList.new();

        const params = CardanoWasm.PlutusList.new();
        {
            // const adminPkhLs = CardanoWasm.PlutusList.new();
            for (let i = 0; i < signatories.length; i++) {
                // adminPkhLs.add();
                params.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(signatories[i], 'hex')));
            }
            // params.add(CardanoWasm.PlutusData.new_list(adminPkhLs));
        }

        ls.add(CardanoWasm.PlutusData.new_list(params));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('' + minNumSignatures)));

        // CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'))
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        )
    }

    static getSignatoriesInfoFromDatum(plutusDataHex) {
        const datum = CardanoWasm.PlutusData.from_hex(plutusDataHex);
        // console.log(datum.to_json());
        const adminPkhLs = datum.as_constr_plutus_data().data().get(0).as_list();

        let ret = { signatories: [] };
        for (let i = 0; i < adminPkhLs.len(); i++) {
            ret.signatories.push(Buffer.from(adminPkhLs.get(i).as_bytes()).toString('hex'));
        }
        ret.minNumSignatures = datum.as_constr_plutus_data().data().get(1).as_integer().to_str() * 1;

        return ret;
    }

    static genRedeemerData(action) {
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('' + action),
                CardanoWasm.PlutusList.new()
            )
        )
        // return CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(action + ''));
    }

    static async addSignature(tx, signFn) {
        const body = tx.body();
        const txHash = CardanoWasm.hash_transaction(body);
        const signResult = await signFn(txHash.to_hex());

        let witnessSet;
        if (tx.witness_set()) {
            witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
        } else {
            witnessSet = CardanoWasm.TransactionWitnessSet.new();
        }

        const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
        let vkeyWitnesses;
        if (witnessSet.vkeys()) {
            vkeyWitnesses = CardanoWasm.Vkeywitnesses.from_bytes(witnessSet.vkeys().to_bytes());
        } else {
            vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        }

        vkeyWitnesses.add(vkeyWitness);
        witnessSet.set_vkeys(vkeyWitnesses);

        return CardanoWasm.Transaction.new(tx.body(), witnessSet, tx.auxiliary_data());
    }


    static async validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, changeAddress, signatoriesInfo, action, signFn, mustSignBy, exUnitTx) {

        let inputs_arr = [];
        for (let i = 0; i < utxosForFee.length; i++) {
            inputs_arr.push(utxosForFee[i].txHash + '#' + utxosForFee[i].index);
        }
        inputs_arr.push(utxoToSpend.txHash + '#' + utxoToSpend.index);
        inputs_arr.sort();


        const txBuilder = utils.initTxBuilder(protocolParams);
        // {
        //     if (groupInfoNFT) {
        //         const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(groupInfoNFT.txHash, 'hex'));
        //         const input = CardanoWasm.TransactionInput.new(txId, groupInfoNFT.index);
        //         txBuilder.add_reference_input(input);
        //     }
        // }


        // Step 1: add utxo for fee
        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
        }

        // Step 2: add utxo for collateral fee
        let collaterOwnerAddress;
        const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxoCollateral = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoCollateral.value + ''));
            const value = utils.funValue(utxoCollateral.value);
            const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
            txCollateralInputBuilder.add_regular_input(from, input, value);
            collaterOwnerAddress = from;
        }
        txBuilder.set_collateral(txCollateralInputBuilder);

        //Step3: Utxo Spending
        let ex_unit_mem = 7575293;//  4142333
        let ex_unit_cpu = 2880092692; //1447050275
        let exUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str(ex_unit_mem + ''),//(EX_UNIT_A),//TODO----->1854897
            CardanoWasm.BigNum.from_str(ex_unit_cpu + '')//(EX_UNIT_B)306405352 530107903
        );
        if (exUnitTx) {
            const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(exUnitTx['spend:' + index].memory + ''),
                CardanoWasm.BigNum.from_str(exUnitTx['spend:' + index].steps + '')
            );
        }

        const redeemer = CardanoWasm.Redeemer.new(
            CardanoWasm.RedeemerTag.new_spend(),
            CardanoWasm.BigNum.from_str('0'),
            AdminNFTHolderScript.genRedeemerData(action),
            exUnits
        );

        const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
        const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
        const value = utils.funValue(utxoToSpend.value);
        const scriptRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(scriptRef.txHash, 'hex')), scriptRef.index);
        const witness = CardanoWasm.PlutusWitness.new_with_ref(
            CardanoWasm.PlutusScriptSource.new_ref_input(GroupInfoNFTHolderScript.script().hash(), scriptRefInput, GroupInfoNFTHolderScript.script().language_version(),GroupInfoNFTHolderScript.script().bytes().byteLength)
            , CardanoWasm.DatumSource.new_ref_input(input)
            , redeemer);
        txInputBuilder.add_plutus_script_input(witness, input, value);


        txBuilder.set_inputs(txInputBuilder);

        //Step 4: output
        let adminNFTDatum;
        switch (action) {
            case this.Update:
                if (signatoriesInfo.signatories.length < signatoriesInfo.minNumSignatures) throw `signatory count(${signatoriesInfo.signatories.length}) < minNumSignatures(${signatoriesInfo.minNumSignatures})`;
                adminNFTDatum = this.genDatum(signatoriesInfo.signatories, signatoriesInfo.minNumSignatures);
                break;
            case this.Upgrade:
                adminNFTDatum = signatoriesInfo.datum
                break;
            default:
                throw 'bad action in AdminNFT';
                break;
        }

        let outputAddress;
        if (action != this.Upgrade) {
            outputAddress = CardanoWasm.Address.from_bech32(utxoToSpend.address);
        } else {
            outputAddress = CardanoWasm.Address.from_bech32(signatoriesInfo.owner);
        }
        const minAdaWithToken = utils.getMinAdaOfUtxo(protocolParams, outputAddress, value, adminNFTDatum);

        const scriptHash = AdminNFT.script().hash();
        const assetName = CardanoWasm.AssetName.new(Buffer.from(AdminNFTName));
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);

        const outputValue = CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaWithToken), mutiAsset);


        const output = CardanoWasm.TransactionOutput.new(outputAddress, outputValue);
        if (adminNFTDatum) {
            output.set_plutus_data(adminNFTDatum);
        }
        txBuilder.add_output(output);


        // Step 5: set script_hash
        const costModesLib = getCostModels(protocolParams);
        txBuilder.calc_script_data_hash(costModesLib);

        //Step 6: add required signatories

        const oldSignatories = this.getSignatoriesInfoFromDatum(utxoToSpend.datum);
        if (mustSignBy.length < oldSignatories.minNumSignatures) {
            throw `not reached the threshold(signatories=${mustSignBy.length} < minNumSignatures=${oldSignatories.minNumSignatures})`;
        }
        for (let i = 0; i < mustSignBy.length; i++) {
            if (oldSignatories.signatories.indexOf(mustSignBy[i]) < 0) {
                throw "required signatory is not in admin list"
            }
            txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(mustSignBy[i]));
        }
        // for (let i = 0; i < oldSignatories.signatories.length; i++) {
        //     const signatory = oldSignatories[i];
        //     txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(signatory));
        // }

        // if (ttl) txBuilder.set_ttl(ttl);


        const minFee = txBuilder.min_fee();
        txBuilder.set_total_collateral_and_return(minFee.checked_mul(CardanoWasm.BigNum.from_str('2')), collaterOwnerAddress);

        txBuilder.add_change_if_needed(CardanoWasm.Address.from_bech32(changeAddress));
        // const minFee2 = txBuilder.min_fee();

        let tx = txBuilder.build_tx();
        // console.log('script_data_hash:', tx.body().script_data_hash().to_hex());

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

    static async update(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, changeAddress, signatories, minNumSignatures, signFn, mustSignBy, exUnitTx) {
        const signatoriesInfo = { signatories, minNumSignatures };
        return await this.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, changeAddress, signatoriesInfo, this.Update, signFn, mustSignBy, exUnitTx);
    }

    static async upgrade(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, changeAddress, owner, datum, signFn, mustSignBy, exUnitTx) {
        const signatoriesInfo = { owner, datum };
        return await this.validator(protocolParams, utxosForFee, utxoForCollateral, utxoToSpend, scriptRef, changeAddress, signatoriesInfo, this.Upgrade, signFn, mustSignBy, exUnitTx);
    }

    static usingAdminNft(protocolParams, txBuilder, txInputBuilder, adminNftUtxo, adminNftHoldRefScript, mustSignBy, exUnitEVA) {
        const utxoToSpend = adminNftUtxo;
        const addressType = utils.addressType(utxoToSpend.address);

        const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
        const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
        const value = utils.funValue(utxoToSpend.value);

        let adminNFTDatum;

        if (addressType == CardanoWasm.CredKind.Key) {
            const adminPkh = utils.addressToPkhOrScriptHash(utxoToSpend.address);
            txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(adminPkh));
            const from = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            txInputBuilder.add_regular_input(from, input, value);

        } else {
            let ex_unit_mem = exUnitEVA ? exUnitEVA.memory : 5075293;//  4142333
            let ex_unit_cpu = exUnitEVA ? exUnitEVA.steps : 1664676406; //1447050275
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(ex_unit_mem + ''),//(EX_UNIT_A),//TODO----->1854897
                CardanoWasm.BigNum.from_str(ex_unit_cpu + '')//(EX_UNIT_B)306405352 530107903
            );
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('0'),
                AdminNFTHolderScript.genRedeemerData(AdminNFTHolderScript.Use),
                exUnits
            );

            const scriptRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(adminNftHoldRefScript.txHash, 'hex')), adminNftHoldRefScript.index);

            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(adminNftHoldRefScript);

            const witness = CardanoWasm.PlutusWitness.new_with_ref_without_datum(
                CardanoWasm.PlutusScriptSource.new_ref_input(scriptTmp.hash(), scriptRefInput, scriptTmp.language_version(),scriptSize)
                , redeemer
            )
            txInputBuilder.add_plutus_script_input(witness, input, value);

            const signatoriesInfo = this.getSignatoriesInfoFromDatum(utxoToSpend.datum);
            if (mustSignBy.length < signatoriesInfo.minNumSignatures) {
                throw `not reached the threshold(signatories=${mustSignBy.length} < minNumSignatures=${signatoriesInfo.minNumSignatures})`;
            }
            for (let i = 0; i < mustSignBy.length; i++) {
                if (!signatoriesInfo.signatories.includes(mustSignBy[i])) {
                    throw "required signatory is not in admin list"
                }
                txBuilder.add_required_signer(CardanoWasm.Ed25519KeyHash.from_hex(mustSignBy[i]));
            }
            if (utxoToSpend.datum) {
                adminNFTDatum = this.genDatum(signatoriesInfo.signatories, signatoriesInfo.minNumSignatures)
            }
        }

        let outputAddress = CardanoWasm.Address.from_bech32(utxoToSpend.address);


        const minAdaWithToken = utils.getMinAdaOfUtxo(protocolParams, outputAddress, value, adminNFTDatum);

        const scriptHash = AdminNFT.script().hash();
        const assetName = CardanoWasm.AssetName.new(Buffer.from(AdminNFTName));
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const asset = CardanoWasm.Assets.new();
        asset.insert(assetName, CardanoWasm.BigNum.from_str('1'));
        mutiAsset.insert(scriptHash, asset);

        const outputValue = CardanoWasm.Value.new_with_assets(CardanoWasm.BigNum.from_str('' + minAdaWithToken), mutiAsset);


        const output = CardanoWasm.TransactionOutput.new(outputAddress, outputValue);
        if (adminNFTDatum) output.set_plutus_data(adminNFTDatum);
        txBuilder.add_output(output);
    }


}

class StoremanStackScript {
    static script() {
        return storemanStakeScript;
    }

    static address() {
        return CardanoWasm.RewardAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(this.script().hash())).to_address();
    }

    static async register(protocolParams, utxosForFee, changeAddress, signFn) {
        const txBuilder = utils.initTxBuilder(protocolParams);

        // Step 1: add utxo for fee
        const txInputBuilder = CardanoWasm.TxInputsBuilder.new();
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            txInputBuilder.add_regular_input(from, input, value);
        }

        // Step 2: add utxo for collateral fee
        const stakeRegistration = CardanoWasm.StakeRegistration.new(CardanoWasm.Credential.from_scripthash(this.script().hash()));
        const stakeResistrationCertificate = CardanoWasm.Certificate.new_stake_registration(stakeRegistration);
        const certificates = CardanoWasm.Certificates.new();
        certificates.add(stakeResistrationCertificate);

        txBuilder.set_certs(certificates);
        txBuilder.set_inputs(txInputBuilder);
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

        return CardanoWasm.Transaction.new(tx.body(), witnessSet);


    }

    static async delegate(protocolParams, utxosForFee, changeAddress, utxoForCollateral, groupInfoNft, pool, stakeScriptRef, stakeCheckRefScript, stakeCheckUtxo
        , adminNftUtxo, adminNftHoldRefScript, mustSignBy, signFn, exUnitTx) {

        const fee = CardanoWasm.BigNum.from_str('256907');//fake fee value 255499

        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'));

        const inputs = CardanoWasm.TransactionInputs.new();
        const refInputs = CardanoWasm.TransactionInputs.new();
        const redeemers = CardanoWasm.Redeemers.new();
        const outputs = CardanoWasm.TransactionOutputs.new();
        const outputsFinal = CardanoWasm.TransactionOutputs.new();
        const certificates = CardanoWasm.Certificates.new();
        const requriedSigners = CardanoWasm.Ed25519KeyHashes.new();
        let totalExUnitsMem = 0;
        let totalExUintsCpu = 0;
        let inputs_arr = [];

        // const datums = CardanoWasm.PlutusList.new();

        let totalInputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        let totalOutValueWithowChange = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            // const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            totalInputValue = totalInputValue.checked_add(value);
            inputs.add(input);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
        }

        inputs_arr.push(stakeCheckUtxo.txHash + '#' + stakeCheckUtxo.index);
        inputs_arr.push(adminNftUtxo.txHash + '#' + adminNftUtxo.index);
        inputs_arr.sort();

        const changeAddr = CardanoWasm.Address.from_bech32(changeAddress);

        let groupInfoNftInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(groupInfoNft.txHash, 'hex')), groupInfoNft.index);
        refInputs.add(groupInfoNftInput);

        {// add stakescipt 
            let stakeRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeScriptRef.txHash, 'hex')), stakeScriptRef.index);
            refInputs.add(stakeRefScriptInput);

            const redeemerData = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
            let mem = 2500000;
            let cpu = 870000000;

            if (exUnitTx) {
                mem = exUnitTx['certs:0'].memory;
                cpu = exUnitTx['certs:0'].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;

            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_cert(),
                CardanoWasm.BigNum.from_str('0'),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);

            const stk = CardanoWasm.Credential.from_scripthash(StoremanStackScript.script().hash());
            // const stk = CardanoWasm.Credential.from_keyhash(CardanoWasm.Ed25519KeyHash.from_hex(utils.addressToPkhOrScriptHash(changeAddress)));
            const stakeDelegation = CardanoWasm.StakeDelegation.new(
                stk//CardanoWasm.Credential.from_scripthash(this.script().hash())
                , CardanoWasm.Ed25519KeyHash.from_bech32(pool));
            // console.log(stakeDelegation.to_json());
            const stakeDelegationCertificate = CardanoWasm.Certificate.new_stake_delegation(stakeDelegation);
            certificates.add(stakeDelegationCertificate);
        }

        {// add StakeCheck 
            const utxoToSpend = stakeCheckUtxo;

            let stakeCheckRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeCheckRefScript.txHash, 'hex')), stakeCheckRefScript.index);
            refInputs.add(stakeCheckRefScriptInput);

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            inputs.add(input);

            // refInputs.add(input);

            const value = utils.funValue(utxoToSpend.value);
            const owner = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            const output = CardanoWasm.TransactionOutput.new(owner, value);
            if (utxoToSpend.datum) output.set_plutus_data(CardanoWasm.PlutusData.from_hex(utxoToSpend.datum));
            outputs.add(output);
            outputsFinal.add(output);
            totalOutValueWithowChange = totalOutValueWithowChange.checked_add(value);

            totalInputValue = totalInputValue.checked_add(value);

            const redeemerData = StakeCheckScript.genRedeemerData(StakeCheckScript.SpendU);
            let mem = 5000000;
            let cpu = 1500000001;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
                mem = exUnitTx['spend:' + index].memory;
                cpu = exUnitTx['spend:' + index].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;


            const offset = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('' + offset),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);
        }

        {// add AdminNFTHolder 
            const utxoToSpend = adminNftUtxo;

            let adminNftHoldRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(adminNftHoldRefScript.txHash, 'hex')), adminNftHoldRefScript.index);
            refInputs.add(adminNftHoldRefScriptInput);

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            inputs.add(input);

            const value = utils.funValue(utxoToSpend.value);
            const owner = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            const output = CardanoWasm.TransactionOutput.new(owner, value);
            output.set_plutus_data(CardanoWasm.PlutusData.from_hex(utxoToSpend.datum));
            outputs.add(output);
            outputsFinal.add(output);

            totalOutValueWithowChange = totalOutValueWithowChange.checked_add(value);

            totalInputValue = totalInputValue.checked_add(value);


            const redeemerData = AdminNFTHolderScript.genRedeemerData(AdminNFTHolderScript.Use);
            let mem = 5100000;
            let cpu = 1500000000;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
                mem = exUnitTx['spend:' + index].memory;
                cpu = exUnitTx['spend:' + index].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;

            const offset = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('' + offset),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);

            const signatoriesInfo = AdminNFTHolderScript.getSignatoriesInfoFromDatum(utxoToSpend.datum);
            if (mustSignBy.length < signatoriesInfo.minNumSignatures) {
                throw `not reached the threshold(signatories=${mustSignBy.length} < minNumSignatures=${signatoriesInfo.minNumSignatures})`;
            }
            for (let i = 0; i < mustSignBy.length; i++) {
                if (!signatoriesInfo.signatories.includes(mustSignBy[i])) {
                    throw "required signatory is not in admin list"
                }
                requriedSigners.add(CardanoWasm.Ed25519KeyHash.from_hex(mustSignBy[i]));
            }
        }

        //add fee change output
        const changeAmount = totalInputValue.checked_sub(CardanoWasm.Value.new(fee));
        const changeOutput = CardanoWasm.TransactionOutput.new(changeAddr, changeAmount);
        outputs.add(changeOutput);

        const memPriceParams = protocolParams.prices.memory.split('/');
        const stepPriceParams = protocolParams.prices.steps.split('/');
        const totalExUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str(totalExUnitsMem + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str(totalExUintsCpu + '')//(EX_UNIT_B)306405352
        );
        const exUnitPrice = CardanoWasm.ExUnitPrices.new(
            CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(memPriceParams[0]), CardanoWasm.BigNum.from_str(memPriceParams[1]))
            , CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(stepPriceParams[0]), CardanoWasm.BigNum.from_str(stepPriceParams[1])))
        const plutusCost = CardanoWasm.calculate_ex_units_ceil_cost(totalExUnits, exUnitPrice);
        const costModesLib = getCostModels(protocolParams);
        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // const hash = CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('30e9081d1297caf2ea2eea4d0735ed3b751b3fa3422095275fa7f5887c01cdf2', 'hex'))
        // console.log('\n\nHASH ===>', Buffer.from(hash.to_bytes()).toString('hex'), '\n\n');
        // body.set_script_data_hash(CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('13bf50ca49247223b9039bf9a410e8e4783c947e8672885533133ddd86fac42c', 'hex')));

        const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSet.set_redeemers(redeemers);

        let body = CardanoWasm.TransactionBody.new_tx_body(inputs, outputs, fee);
        body.set_required_signers(requriedSigners);


        // if (ttl) body.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        let collaterOwnerAddress;
        const collateralInputs = CardanoWasm.TransactionInputs.new();
        let totalCollateralValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxo = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxo.index);
            collaterOwnerAddress = CardanoWasm.Address.from_bech32(utxo.address);
            collateralInputs.add(input);
            const value = utils.funValue(utxo.value);
            totalCollateralValue = totalCollateralValue.checked_add(value);
        }

        // console.log('totalCollateralValue =', totalCollateralValue.to_json(), 'fee =', fee.to_str());

        const collateralFee = fee.checked_mul(CardanoWasm.BigNum.from_str('2'));
        const collateralChangeValue = totalCollateralValue.checked_sub(CardanoWasm.Value.new(collateralFee));
        const collaterChangeOutput = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralChangeValue);

        body.set_collateral(collateralInputs);
        // body.set_total_collateral()
        body.set_collateral_return(collaterChangeOutput);
        body.set_reference_inputs(refInputs);
        body.set_script_data_hash(hash);
        body.set_certs(certificates);


        let txBodyHash = CardanoWasm.hash_transaction(body);
        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        vkeyWitnesses.add(CardanoWasm.make_vkey_witness(txBodyHash, payPrvKey));

        transactionWitnessSet.set_vkeys(vkeyWitnesses);

        const signedTx = CardanoWasm.Transaction.new(body, transactionWitnessSet)

        const txfeeWithoutPlutus = CardanoWasm.BigNum.from_str('' + protocolParams.minFeeCoefficient).checked_mul(
            CardanoWasm.BigNum.from_str('' + signedTx.to_bytes().byteLength)
        ).checked_add(CardanoWasm.BigNum.from_str('' + protocolParams.minFeeConstant));
        // console.log('txfeeWithoutPlutus=', txfeeWithoutPlutus.to_str());

        const total_fee = plutusCost.checked_add(txfeeWithoutPlutus).checked_mul(CardanoWasm.BigNum.from_str('2'));
        // console.log('total-fee:', total_fee.to_str());

        const changeAmountNew = totalInputValue.checked_sub(totalOutValueWithowChange).checked_sub(CardanoWasm.Value.new(total_fee));
        const changeOutPutNew = CardanoWasm.TransactionOutput.new(changeAddr, changeAmountNew);
        outputsFinal.add(changeOutPutNew);

        const collateralFeeNew = total_fee.checked_mul(CardanoWasm.BigNum.from_str('2'));
        const collateralChangeValueNew = totalCollateralValue.checked_sub(CardanoWasm.Value.new(collateralFeeNew));
        const collaterChangeOutputNew = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralChangeValueNew);

        let bodyNew = CardanoWasm.TransactionBody.new_tx_body(inputs, outputsFinal, total_fee);
        bodyNew.set_reference_inputs(refInputs);
        bodyNew.set_collateral(collateralInputs);
        bodyNew.set_collateral_return(collaterChangeOutputNew);
        bodyNew.set_script_data_hash(hash);
        bodyNew.set_certs(certificates);
        bodyNew.set_required_signers(requriedSigners);
        // if (ttl) bodyNew.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        const transactionWitnessSetNew = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSetNew.set_redeemers(redeemers);

        if (signFn) {
            const txBodyHashNew = CardanoWasm.hash_transaction(bodyNew);
            const signResult = await signFn(txBodyHashNew.to_hex());
            const vkeyWitnessesNew = CardanoWasm.Vkeywitnesses.new();
            const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
            vkeyWitnessesNew.add(vkeyWitness);
            transactionWitnessSetNew.set_vkeys(vkeyWitnessesNew);
        }


        return CardanoWasm.Transaction.new(bodyNew, transactionWitnessSetNew);
    }

    static async claim(protocolParams, utxosForFee, changeAddress, utxoForCollateral, groupInfoNft, stakeScriptRef, stakeCheckRefScript, stakeCheckUtxo
        , adminNftUtxo, adminNftHoldRefScript, mustSignBy, signFn, claimTo, claimAmount, exUnitTx) {
        const fee = CardanoWasm.BigNum.from_str('256907');//fake fee value 255499

        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'));

        const inputs = CardanoWasm.TransactionInputs.new();
        const refInputs = CardanoWasm.TransactionInputs.new();
        const redeemers = CardanoWasm.Redeemers.new();
        const outputs = CardanoWasm.TransactionOutputs.new();
        const outputsFinal = CardanoWasm.TransactionOutputs.new();
        const withdraws = CardanoWasm.Withdrawals.new();
        const requriedSigners = CardanoWasm.Ed25519KeyHashes.new();
        let totalExUnitsMem = 0;
        let totalExUintsCpu = 0;
        let inputs_arr = [];

        // const datums = CardanoWasm.PlutusList.new();
        let groupInfoNftInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(groupInfoNft.txHash, 'hex')), groupInfoNft.index);
        refInputs.add(groupInfoNftInput);

        let totalInputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        let totalOutValueWithowChange = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            // const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            totalInputValue = totalInputValue.checked_add(value);
            inputs.add(input);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
        }

        inputs_arr.push(stakeCheckUtxo.txHash + '#' + stakeCheckUtxo.index);
        inputs_arr.push(adminNftUtxo.txHash + '#' + adminNftUtxo.index);
        inputs_arr.sort();

        const changeAddr = CardanoWasm.Address.from_bech32(changeAddress);

        {// add stakescipt 
            let stakeRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeScriptRef.txHash, 'hex')), stakeScriptRef.index);
            refInputs.add(stakeRefScriptInput);

            const redeemerData = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
            let mem = 2503197;
            let cpu = 870405352;
            if (exUnitTx) {
                mem = exUnitTx['withdrawal:0'].memory;
                cpu = exUnitTx['withdrawal:0'].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;

            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_reward(),
                CardanoWasm.BigNum.from_str('0'),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);

            const rewardAddr = CardanoWasm.RewardAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(this.script().hash()));
            withdraws.insert(rewardAddr, CardanoWasm.BigNum.from_str('' + claimAmount));

            const claimToAddr = CardanoWasm.Address.from_bech32(claimTo);
            const rewardOutput = CardanoWasm.TransactionOutput.new(claimToAddr, CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + claimAmount)));
            outputs.add(rewardOutput);
            outputsFinal.add(rewardOutput);
        }

        {// add StakeCheck 
            const utxoToSpend = stakeCheckUtxo;

            let stakeCheckRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeCheckRefScript.txHash, 'hex')), stakeCheckRefScript.index);
            refInputs.add(stakeCheckRefScriptInput);

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            inputs.add(input);

            refInputs.add(input);

            const value = utils.funValue(utxoToSpend.value);
            const owner = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            const output = CardanoWasm.TransactionOutput.new(owner, value);
            if (utxoToSpend.datum) output.set_plutus_data(CardanoWasm.PlutusData.from_hex(utxoToSpend.datum));
            outputs.add(output);
            outputsFinal.add(output);
            totalOutValueWithowChange = totalOutValueWithowChange.checked_add(value);

            totalInputValue = totalInputValue.checked_add(value);

            const redeemerData = StakeCheckScript.genRedeemerData(StakeCheckScript.SpendU);
            let mem = 5000197;
            let cpu = 1500405352;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
                mem = exUnitTx['spend:' + index].memory;
                cpu = exUnitTx['spend:' + index].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;


            const offset = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('' + offset),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);
        }

        {// add AdminNFTHolder 
            const utxoToSpend = adminNftUtxo;

            let adminNftHoldRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(adminNftHoldRefScript.txHash, 'hex')), adminNftHoldRefScript.index);
            refInputs.add(adminNftHoldRefScriptInput);

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            inputs.add(input);

            const value = utils.funValue(utxoToSpend.value);
            const owner = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            const output = CardanoWasm.TransactionOutput.new(owner, value);
            output.set_plutus_data(CardanoWasm.PlutusData.from_hex(utxoToSpend.datum));
            outputs.add(output);
            outputsFinal.add(output);

            totalOutValueWithowChange = totalOutValueWithowChange.checked_add(value);

            totalInputValue = totalInputValue.checked_add(value);


            const redeemerData = AdminNFTHolderScript.genRedeemerData(AdminNFTHolderScript.Use);
            let mem = 5000097;
            let cpu = 1500005352;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
                mem = exUnitTx['spend:' + index].memory;
                cpu = exUnitTx['spend:' + index].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;

            const offset = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('' + offset),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);

            const signatoriesInfo = AdminNFTHolderScript.getSignatoriesInfoFromDatum(utxoToSpend.datum);
            if (mustSignBy.length < signatoriesInfo.minNumSignatures) {
                throw `not reached the threshold(signatories=${mustSignBy.length} < minNumSignatures=${signatoriesInfo.minNumSignatures})`;
            }
            for (let i = 0; i < mustSignBy.length; i++) {
                if (!signatoriesInfo.signatories.includes(mustSignBy[i])) {
                    throw "required signatory is not in admin list"
                }
                requriedSigners.add(CardanoWasm.Ed25519KeyHash.from_hex(mustSignBy[i]));
            }
        }

        //add fee change output
        const changeAmount = totalInputValue.checked_sub(CardanoWasm.Value.new(fee));
        const changeOutput = CardanoWasm.TransactionOutput.new(changeAddr, changeAmount);
        outputs.add(changeOutput);


        const memPriceParams = protocolParams.prices.memory.split('/');
        const stepPriceParams = protocolParams.prices.steps.split('/');
        const totalExUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str(totalExUnitsMem + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str(totalExUintsCpu + '')//(EX_UNIT_B)306405352
        );
        const exUnitPrice = CardanoWasm.ExUnitPrices.new(
            CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(memPriceParams[0]), CardanoWasm.BigNum.from_str(memPriceParams[1]))
            , CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(stepPriceParams[0]), CardanoWasm.BigNum.from_str(stepPriceParams[1])))
        const plutusCost = CardanoWasm.calculate_ex_units_ceil_cost(totalExUnits, exUnitPrice);
        const costModesLib = getCostModels(protocolParams);
        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // const hash = CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('30e9081d1297caf2ea2eea4d0735ed3b751b3fa3422095275fa7f5887c01cdf2', 'hex'))
        // console.log('\n\nHASH ===>', Buffer.from(hash.to_bytes()).toString('hex'), '\n\n');
        // body.set_script_data_hash(CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('13bf50ca49247223b9039bf9a410e8e4783c947e8672885533133ddd86fac42c', 'hex')));

        const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSet.set_redeemers(redeemers);

        let body = CardanoWasm.TransactionBody.new_tx_body(inputs, outputs, fee);
        body.set_required_signers(requriedSigners);


        // if (ttl) body.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        let collaterOwnerAddress;
        const collateralInputs = CardanoWasm.TransactionInputs.new();
        let totalCollateralValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxo = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxo.index);
            collaterOwnerAddress = CardanoWasm.Address.from_bech32(utxo.address);
            collateralInputs.add(input);
            const value = utils.funValue(utxo.value);
            totalCollateralValue = totalCollateralValue.checked_add(value);
        }


        const collateralFee = fee.checked_mul(CardanoWasm.BigNum.from_str('2'));
        // console.log('totalCollateralValue =', totalCollateralValue.to_json(), 'fee =', fee.to_str(),collateralFee.to_json());
        const collateralChangeValue = totalCollateralValue.checked_sub(CardanoWasm.Value.new(collateralFee));
        const collaterChangeOutput = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralChangeValue);

        body.set_collateral(collateralInputs);
        // body.set_total_collateral()
        body.set_collateral_return(collaterChangeOutput);
        body.set_reference_inputs(refInputs);
        body.set_script_data_hash(hash);
        body.set_withdrawals(withdraws);


        let txBodyHash = CardanoWasm.hash_transaction(body);
        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        vkeyWitnesses.add(CardanoWasm.make_vkey_witness(txBodyHash, payPrvKey));

        transactionWitnessSet.set_vkeys(vkeyWitnesses);

        const signedTx = CardanoWasm.Transaction.new(body, transactionWitnessSet)

        const txfeeWithoutPlutus = CardanoWasm.BigNum.from_str('' + protocolParams.minFeeCoefficient).checked_mul(
            CardanoWasm.BigNum.from_str('' + signedTx.to_bytes().byteLength)
        ).checked_add(CardanoWasm.BigNum.from_str('' + protocolParams.minFeeConstant));
        // console.log('txfeeWithoutPlutus=', txfeeWithoutPlutus.to_str());

        const total_fee = plutusCost.checked_add(txfeeWithoutPlutus);
        // console.log('total-fee:',total_fee.to_str())

        const changeAmountNew = totalInputValue.checked_sub(totalOutValueWithowChange).checked_sub(CardanoWasm.Value.new(total_fee));
        const changeOutPutNew = CardanoWasm.TransactionOutput.new(changeAddr, changeAmountNew);
        outputsFinal.add(changeOutPutNew);

        const collateralFeeNew = total_fee.checked_mul(CardanoWasm.BigNum.from_str('2'));
        const collateralChangeValueNew = totalCollateralValue.checked_sub(CardanoWasm.Value.new(collateralFeeNew));
        const collaterChangeOutputNew = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralChangeValueNew);

        let bodyNew = CardanoWasm.TransactionBody.new_tx_body(inputs, outputsFinal, total_fee);
        bodyNew.set_reference_inputs(refInputs);
        bodyNew.set_collateral(collateralInputs);
        bodyNew.set_collateral_return(collaterChangeOutputNew);
        bodyNew.set_script_data_hash(hash);
        bodyNew.set_withdrawals(withdraws);
        bodyNew.set_required_signers(requriedSigners);
        // if (ttl) bodyNew.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        const transactionWitnessSetNew = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSetNew.set_redeemers(redeemers);


        if (signFn) {
            const txBodyHashNew = CardanoWasm.hash_transaction(bodyNew);
            const signResult = await signFn(txBodyHashNew.to_hex());
            const vkeyWitnessesNew = CardanoWasm.Vkeywitnesses.new();
            const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
            vkeyWitnessesNew.add(vkeyWitness);
            transactionWitnessSetNew.set_vkeys(vkeyWitnessesNew);
        }


        return CardanoWasm.Transaction.new(bodyNew, transactionWitnessSetNew);
    }

    static async deregister(protocolParams, utxosForFee, changeAddress, utxoForCollateral, groupInfoNft, stakeScriptRef, stakeCheckRefScript, stakeCheckUtxo
        , adminNftUtxo, adminNftHoldRefScript, mustSignBy, signFn, exUnitTx) {
        const fee = CardanoWasm.BigNum.from_str('256907');//fake fee value 255499

        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'));

        const inputs = CardanoWasm.TransactionInputs.new();
        const refInputs = CardanoWasm.TransactionInputs.new();
        const redeemers = CardanoWasm.Redeemers.new();
        const outputs = CardanoWasm.TransactionOutputs.new();
        const outputsFinal = CardanoWasm.TransactionOutputs.new();
        const certificates = CardanoWasm.Certificates.new();
        const requriedSigners = CardanoWasm.Ed25519KeyHashes.new();
        let totalExUnitsMem = 0;
        let totalExUintsCpu = 0;
        let inputs_arr = [];

        // const datums = CardanoWasm.PlutusList.new();
        let groupInfoNftInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(groupInfoNft.txHash, 'hex')), groupInfoNft.index);
        refInputs.add(groupInfoNftInput);

        let totalInputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        let totalOutValueWithowChange = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxosForFee.length; i++) {
            const utxoForFee = utxosForFee[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoForFee.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoForFee.index);
            // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoForFee.value + ''));
            const value = utils.funValue(utxoForFee.value);
            // const from = CardanoWasm.Address.from_bech32(utxoForFee.address);
            totalInputValue = totalInputValue.checked_add(value);
            inputs.add(input);
            inputs_arr.push(utxoForFee.txHash + '#' + utxoForFee.index);
        }

        inputs_arr.push(stakeCheckUtxo.txHash + '#' + stakeCheckUtxo.index);
        inputs_arr.push(adminNftUtxo.txHash + '#' + adminNftUtxo.index);
        inputs_arr.sort();

        const changeAddr = CardanoWasm.Address.from_bech32(changeAddress);

        {// add stakescipt 
            let stakeRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeScriptRef.txHash, 'hex')), stakeScriptRef.index);
            refInputs.add(stakeRefScriptInput);

            const redeemerData = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
            let mem = 2503197;
            let cpu = 870405352;
            if (exUnitTx) {
                mem = exUnitTx['certs:0'].memory;
                cpu = exUnitTx['certs:0'].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;

            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_cert(),
                CardanoWasm.BigNum.from_str('0'),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);

            const stk = CardanoWasm.Credential.from_scripthash(StoremanStackScript.script().hash());
            // const stk = CardanoWasm.Credential.from_keyhash(CardanoWasm.Ed25519KeyHash.from_hex(utils.addressToPkhOrScriptHash(changeAddress)));
            const stakeDeregistration = CardanoWasm.StakeDeregistration.new(
                stk//CardanoWasm.Credential.from_scripthash(this.script().hash())
            );
            // console.log(stakeDeregistration.to_json());
            const stakeDelegationCertificate = CardanoWasm.Certificate.new_stake_deregistration(stakeDeregistration);
            certificates.add(stakeDelegationCertificate);
        }

        {// add StakeCheck 
            const utxoToSpend = stakeCheckUtxo;

            let stakeCheckRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeCheckRefScript.txHash, 'hex')), stakeCheckRefScript.index);
            refInputs.add(stakeCheckRefScriptInput);

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            inputs.add(input);

            refInputs.add(input);

            const value = utils.funValue(utxoToSpend.value);
            const owner = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            const output = CardanoWasm.TransactionOutput.new(owner, value);
            if (utxoToSpend.datum) output.set_plutus_data(CardanoWasm.PlutusData.from_hex(utxoToSpend.datum));
            outputs.add(output);
            outputsFinal.add(output);
            totalOutValueWithowChange = totalOutValueWithowChange.checked_add(value);

            totalInputValue = totalInputValue.checked_add(value);

            const redeemerData = StakeCheckScript.genRedeemerData(StakeCheckScript.SpendU);
            let mem = 5003197;
            let cpu = 1570405352;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
                mem = exUnitTx['spend:' + index].memory;
                cpu = exUnitTx['spend:' + index].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;


            const offset = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('' + offset),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);
        }

        {// add AdminNFTHolder 
            const utxoToSpend = adminNftUtxo;

            let adminNftHoldRefScriptInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(adminNftHoldRefScript.txHash, 'hex')), adminNftHoldRefScript.index);
            refInputs.add(adminNftHoldRefScriptInput);

            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            inputs.add(input);

            const value = utils.funValue(utxoToSpend.value);
            const owner = CardanoWasm.Address.from_bech32(utxoToSpend.address);
            const output = CardanoWasm.TransactionOutput.new(owner, value);
            output.set_plutus_data(CardanoWasm.PlutusData.from_hex(utxoToSpend.datum));
            outputs.add(output);
            outputsFinal.add(output);

            totalOutValueWithowChange = totalOutValueWithowChange.checked_add(value);

            totalInputValue = totalInputValue.checked_add(value);


            const redeemerData = AdminNFTHolderScript.genRedeemerData(AdminNFTHolderScript.Use);
            let mem = 5003197;
            let cpu = 1570405352;
            if (exUnitTx) {
                const index = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
                mem = exUnitTx['spend:' + index].memory;
                cpu = exUnitTx['spend:' + index].steps;
            }
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(mem + ''),//(EX_UNIT_A),//TODO----->903197
                CardanoWasm.BigNum.from_str(cpu + '')//(EX_UNIT_B)306405352
            );
            totalExUnitsMem += mem;
            totalExUintsCpu += cpu;

            const offset = inputs_arr.indexOf(utxoToSpend.txHash + '#' + utxoToSpend.index);
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('' + offset),
                redeemerData,
                exUnits
            );
            redeemers.add(redeemer);

            const signatoriesInfo = AdminNFTHolderScript.getSignatoriesInfoFromDatum(utxoToSpend.datum);
            if (mustSignBy.length < signatoriesInfo.minNumSignatures) {
                throw `not reached the threshold(signatories=${mustSignBy.length} < minNumSignatures=${signatoriesInfo.minNumSignatures})`;
            }
            for (let i = 0; i < mustSignBy.length; i++) {
                if (!signatoriesInfo.signatories.includes(mustSignBy[i])) {
                    throw "required signatory is not in admin list"
                }
                requriedSigners.add(CardanoWasm.Ed25519KeyHash.from_hex(mustSignBy[i]));
            }
        }

        //add fee change output
        const changeAmount = totalInputValue
            .checked_sub(CardanoWasm.Value.new(fee))
            .checked_add(CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + protocolParams.stakeKeyDeposit)));
        const changeOutput = CardanoWasm.TransactionOutput.new(changeAddr, changeAmount);
        outputs.add(changeOutput);

        const memPriceParams = protocolParams.prices.memory.split('/');
        const stepPriceParams = protocolParams.prices.steps.split('/');
        const totalExUnits = CardanoWasm.ExUnits.new(
            CardanoWasm.BigNum.from_str(totalExUnitsMem + ''),//(EX_UNIT_A),//TODO----->903197
            CardanoWasm.BigNum.from_str(totalExUintsCpu + '')//(EX_UNIT_B)306405352
        );
        const exUnitPrice = CardanoWasm.ExUnitPrices.new(
            CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(memPriceParams[0]), CardanoWasm.BigNum.from_str(memPriceParams[1]))
            , CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(stepPriceParams[0]), CardanoWasm.BigNum.from_str(stepPriceParams[1])))
        const plutusCost = CardanoWasm.calculate_ex_units_ceil_cost(totalExUnits, exUnitPrice);
        const costModesLib = getCostModels(protocolParams);
        const tmp = CardanoWasm.Costmdls.new();
        tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
        const hash = CardanoWasm.hash_script_data(redeemers, tmp);
        // const hash = CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('30e9081d1297caf2ea2eea4d0735ed3b751b3fa3422095275fa7f5887c01cdf2', 'hex'))
        // console.log('\n\nHASH ===>', Buffer.from(hash.to_bytes()).toString('hex'), '\n\n');
        // body.set_script_data_hash(CardanoWasm.ScriptDataHash.from_bytes(Buffer.from('13bf50ca49247223b9039bf9a410e8e4783c947e8672885533133ddd86fac42c', 'hex')));

        const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSet.set_redeemers(redeemers);

        let body = CardanoWasm.TransactionBody.new_tx_body(inputs, outputs, fee);
        body.set_required_signers(requriedSigners);


        // if (ttl) body.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        let collaterOwnerAddress;
        const collateralInputs = CardanoWasm.TransactionInputs.new();
        let totalCollateralValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('0'));
        for (let i = 0; i < utxoForCollateral.length; i++) {
            const utxo = utxoForCollateral[i];
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxo.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxo.index);
            collaterOwnerAddress = CardanoWasm.Address.from_bech32(utxo.address);
            collateralInputs.add(input);
            const value = utils.funValue(utxo.value);
            totalCollateralValue = totalCollateralValue.checked_add(value);
        }

        // console.log('totalCollateralValue =', totalCollateralValue.to_json(), 'fee =', fee.to_str());

        const collateralFee = fee.checked_mul(CardanoWasm.BigNum.from_str('2'));
        const collateralChangeValue = totalCollateralValue.checked_sub(CardanoWasm.Value.new(collateralFee));
        const collaterChangeOutput = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralChangeValue);

        body.set_collateral(collateralInputs);
        // body.set_total_collateral()
        body.set_collateral_return(collaterChangeOutput);
        body.set_reference_inputs(refInputs);
        body.set_script_data_hash(hash);
        body.set_certs(certificates);


        let txBodyHash = CardanoWasm.hash_transaction(body);
        const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
        vkeyWitnesses.add(CardanoWasm.make_vkey_witness(txBodyHash, payPrvKey));

        transactionWitnessSet.set_vkeys(vkeyWitnesses);

        const signedTx = CardanoWasm.Transaction.new(body, transactionWitnessSet)

        const txfeeWithoutPlutus = CardanoWasm.BigNum.from_str('' + protocolParams.minFeeCoefficient).checked_mul(
            CardanoWasm.BigNum.from_str('' + signedTx.to_bytes().byteLength)
        ).checked_add(CardanoWasm.BigNum.from_str('' + protocolParams.minFeeConstant));
        // console.log('txfeeWithoutPlutus=', txfeeWithoutPlutus.to_str());

        const total_fee = plutusCost.checked_add(txfeeWithoutPlutus);
        // console.log('total-fee:',total_fee.to_str())

        const changeAmountNew = totalInputValue.checked_sub(totalOutValueWithowChange)
            .checked_sub(CardanoWasm.Value.new(total_fee))
            .checked_add(CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + protocolParams.stakeKeyDeposit)));
        const changeOutPutNew = CardanoWasm.TransactionOutput.new(changeAddr, changeAmountNew);
        outputsFinal.add(changeOutPutNew);

        const collateralFeeNew = total_fee.checked_mul(CardanoWasm.BigNum.from_str('2'));
        const collateralChangeValueNew = totalCollateralValue.checked_sub(CardanoWasm.Value.new(collateralFeeNew));
        const collaterChangeOutputNew = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralChangeValueNew);

        let bodyNew = CardanoWasm.TransactionBody.new_tx_body(inputs, outputsFinal, total_fee);
        bodyNew.set_reference_inputs(refInputs);
        bodyNew.set_collateral(collateralInputs);
        bodyNew.set_collateral_return(collaterChangeOutputNew);
        bodyNew.set_script_data_hash(hash);
        bodyNew.set_certs(certificates);
        bodyNew.set_required_signers(requriedSigners);
        // if (ttl) bodyNew.set_ttl(CardanoWasm.BigNum.from_str('' + ttl));

        const transactionWitnessSetNew = CardanoWasm.TransactionWitnessSet.new();
        transactionWitnessSetNew.set_redeemers(redeemers);


        if (signFn) {
            const txBodyHashNew = CardanoWasm.hash_transaction(bodyNew);
            const signResult = await signFn(txBodyHashNew.to_hex());
            const vkeyWitnessesNew = CardanoWasm.Vkeywitnesses.new();
            const vkeyWitness = CardanoWasm.Vkeywitness.from_json(JSON.stringify(signResult));
            vkeyWitnessesNew.add(vkeyWitness);
            transactionWitnessSetNew.set_vkeys(vkeyWitnessesNew);
        }


        return CardanoWasm.Transaction.new(bodyNew, transactionWitnessSetNew);
    }
}

class StakeCheckScript {
    static WithdrawU = 0;
    static SpendU = 1;
    static script() {
        return stakeCheckScript;
    }

    // static address() {
    //     return CardanoWasm.RewardAddress.new(Network_Id, CardanoWasm.Credential.from_scripthash(this.script().hash())).to_address();
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

    static genRedeemerData(action) {
        // return CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('' + action));
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('' + action),
                CardanoWasm.PlutusList.new()
            )
        )
    }

    static useStakeCheckUtxoInInput(txInputBuilder, stakeCheckUtxo, stakeCheckRefScript) {
        {
            let ex_unit_mem = 7575293;//  4142333
            let ex_unit_cpu = 2880092692; //1447050275
            const exUnits = CardanoWasm.ExUnits.new(
                CardanoWasm.BigNum.from_str(ex_unit_mem + ''),//(EX_UNIT_A),//TODO----->1854897
                CardanoWasm.BigNum.from_str(ex_unit_cpu + '')//(EX_UNIT_B)306405352 530107903
            );
            const redeemer = CardanoWasm.Redeemer.new(
                CardanoWasm.RedeemerTag.new_spend(),
                CardanoWasm.BigNum.from_str('0'),
                StakeCheckScript.genRedeemerData(StakeCheckScript.SpendU),
                exUnits
            );
            const utxoToSpend = stakeCheckUtxo;
            const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoToSpend.txHash, 'hex'));
            const input = CardanoWasm.TransactionInput.new(txId, utxoToSpend.index);
            const value = utils.funValue(utxoToSpend.value);
            const scriptRefInput = CardanoWasm.TransactionInput.new(CardanoWasm.TransactionHash.from_bytes(Buffer.from(stakeCheckRefScript.txHash, 'hex')), stakeCheckRefScript.index);

            const { script: scriptTmp, scriptSize } = utils.plutusScriptFromScriptRef(stakeCheckRefScript);

            const witness = CardanoWasm.PlutusWitness.new_with_ref(
                CardanoWasm.PlutusScriptSource.new_ref_input(StakeCheckScript.script().hash(), scriptRefInput, scriptTmp.language_version(),scriptSize)
                , CardanoWasm.DatumSource.new_ref_input(input)
                , redeemer);
            txInputBuilder.add_plutus_script_input(witness, input, value);
        }
    }


}






let Network_Id = 1
function init(network = true) {
    const currentPlutus = network ? plutus.mainnet : plutus.testnet;
    Network_Id = network ? 1 : 0;

    const groupInfoTokenPlutus = currentPlutus.groupInfoTokenPlutus;
    const groupInfoTokenHolderPlutus = currentPlutus.groupInfoTokenHolderPlutus;
    const adminNFTPlutus = currentPlutus.adminNftPlutus;
    const adminNFTHolderPlutus = currentPlutus.adminNftHolderPlutus;
    const storemanStakePlutus = currentPlutus.storemanStakePlutus;
    const stakeCheckPlutus = currentPlutus.stakeCheckPlutus;


    // if(groupNFTScript) groupNFTScript.free();
    // if(groupNFTHolderScript) groupNFTHolderScript.free();
    // if(adminNFTScript) adminNFTScript.free();
    // if(adminNFTHolderScript) adminNFTHolderScript.free();
    // if(storemanStakeScript) storemanStakeScript.free();
    // if(stakeCheckScript) stakeCheckScript.free();

    groupNFTScript = utils.plutusScriptFromPlutusObj(groupInfoTokenPlutus);
    groupNFTHolderScript = utils.plutusScriptFromPlutusObj(groupInfoTokenHolderPlutus);
    adminNFTScript = utils.plutusScriptFromPlutusObj(adminNFTPlutus);
    adminNFTHolderScript = utils.plutusScriptFromPlutusObj(adminNFTHolderPlutus);
    storemanStakeScript = utils.plutusScriptFromPlutusObj(storemanStakePlutus);
    stakeCheckScript = utils.plutusScriptFromPlutusObj(stakeCheckPlutus);

    // console.log("groupNFTScript:",groupNFTScript.hash().to_hex());
    // console.log("groupNFTHolderScript:",groupNFTHolderScript.hash().to_hex());
}



module.exports = {
    init,
    GroupInfoNFTHolderScript,
    GroupInfoTokenName,
    AdminNFTName,
    GroupNFT,
    AdminNFTHolderScript,
    AdminNFT,
    StoremanStackScript,
    StakeCheckScript
}