
const {
    createInteractionContext,
    createStateQueryClient,
    createTxSubmissionClient, TxSubmission
} = require('@cardano-ogmios/client');
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');

const utils = require('./utils');
const cbor = require('cbor-sync');



//---------------------------------------------------------------------------------------------
let context;
let txSubmitclient;
let query;

const errorHandler = async (error) => {
    console.error(error);
    await txSubmitclient.shutdown();
}

const closeHandler = async (code, reason) => {
    // console.log('WS close: code =', code, 'reason =', reason);
    // await client.shutdown();
}
//---------------------------------------------------------------------------------------------

// const BlockFrostAPI = require('@blockfrost/blockfrost-js').BlockFrostAPI;
// const blockFrostApi = new BlockFrostAPI({ isTestNet: true, projectId: 'testnetuBFkbLWQvS43rZCQSrYkFFL1gnHaxt3Z' });

// const interVia = 'api';
const interVia = 'ogmios';

//--------------------------------------------------
module.exports.getParamProtocol = async function (via = 'ogmios') {
    if (via == 'ogmios') {
        let protocolParams = await query.currentProtocolParameters();

        const v1 = CardanoWasm.CostModel.new();
        let index = 0;
        for (const key in protocolParams.costModels[`plutus:v1`]) {
            v1.set(index, CardanoWasm.Int.new_i32(protocolParams.costModels[`plutus:v1`][key]));
            index++;
        }

        const v2 = CardanoWasm.CostModel.new();
        index = 0;
        for (const key in protocolParams.costModels[`plutus:v2`]) {
            v2.set(index, CardanoWasm.Int.new_i32(protocolParams.costModels[`plutus:v2`][key]));
            index++;
        }

        const v3 = CardanoWasm.CostModel.new();
        index = 0;
        for (const key in protocolParams.costModels[`plutus:v3`]) {
            v3.set(index, CardanoWasm.Int.new_i32(protocolParams.costModels[`plutus:v3`][key]));
            index++;
        }
        protocolParams.costModels = CardanoWasm.Costmdls.new();
        protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v1(), v1);
        protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v2(), v2);
        protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v3(), v3);

        return protocolParams;
    } else {
        throw 'Not Support BlockFrostApi'
        // let latest_block = await blockFrostApi.blocksLatest();
        // let protocolParams = await blockFrostApi.epochsParameters(latest_block.epoch);

        // let index = 0;
        // const v1 = CardanoWasm.CostModel.new();
        // for (const key in protocolParams.cost_models.PlutusV1) {
        //     v1.set(index, CardanoWasm.Int.new_i32(protocolParams.cost_models.PlutusV1[key]));
        //     index++;
        // }

        // const v2 = CardanoWasm.CostModel.new();
        // index = 0;
        // for (const key in protocolParams.cost_models.PlutusV2) {
        //     v2.set(index, CardanoWasm.Int.new_i32(protocolParams.cost_models.PlutusV2[key]));
        //     index++;
        // }

        // protocolParams.costModels = CardanoWasm.Costmdls.new();
        // protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v1(), v1);
        // protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v2(), v2);
        // return protocolParams;
    }

}

module.exports.getScriptRefByScriptHash = async function (scriptRefOwnerAddr, scriptHash) {
    let refUtxo = await this.getUtxo(scriptRefOwnerAddr);
    const ref = refUtxo.find(o => {
        const { script: scriptTmp } = utils.plutusScriptFromScriptRef(o.script);
        return scriptTmp.hash().to_hex() == scriptHash

    });
    return ref;
}

//TODO: -------------------
module.exports.getUtxo = async function (address, coinValue = 0, via = 'ogmios') {
    let ret = [];
    if (via == 'ogmios') {
        let utxos = await query.utxo([address]);
        // console.log("utxos=", utxos)

        for (let i = 0; i < utxos.length; i++) {
            const utxo = utxos[i];
            if (coinValue && CardanoWasm.BigNum.from_str(utxo[1].value.coins + '').compare(
                CardanoWasm.BigNum.from_str('' + coinValue)
            ) < 0) continue;
            for (const assetId in utxo[1].value.assets) {
                // console.log('====<',CardanoWasm.BigNum.from_str(utxo[1].value.assets[assetId]+'').to_str());
                utxo[1].value.assets[assetId] = CardanoWasm.BigNum.from_str(utxo[1].value.assets[assetId] + '').to_str();
            }
            ret.push({
                txHash: utxo[0].txId,
                index: utxo[0].index,
                value: {
                    coins: CardanoWasm.BigNum.from_str(utxo[1].value.coins + '').to_str(),
                    assets: utxo[1].value.assets
                },
                address: utxo[1].address,
                datum: utxo[1].datum,
                datumHash: utxo[1].datumHash,
                script: utxo[1].script
            })
        }
    } else {
        throw 'Not Support BlockFrostApi'
        // const utxos = await blockFrostApi.addressesUtxosAll(address);

        // for (let i = 0; i < utxos.length; i++) {
        //     const utxo = utxos[i];
        //     if (coinValue && CardanoWasm.BigNum.from_str(utxo.amount[0].quantity).compare(
        //         CardanoWasm.BigNum.from_str('' + coinValue)
        //     ) < 0) continue;
        //     ret.push({
        //         txHash: utxo.tx_hash,
        //         index: utxo.output_index,
        //         value: utxo.amount[0].quantity,
        //         address: address
        //     })
        // }
    }

    return ret;

}


module.exports.waitTxConfirmed = async (addr, txHash, slots = 20) => {
    let p = new Promise((resolve, reject) => {
        setTimeout(async (addr, txHash) => {
            const utxos = await this.getUtxo(addr);
            const utxo = utxos.find(o => o.txHash == txHash);
            resolve(utxo);
            // if(utxo) resolve(utxo);
            // else {
            //     if(slots<=0) reject('Timeout');
            //     else{
            //         const ret = await waitTxConfirmed(addr,txHash,slots-1);
            //         resolve(ret);
            //     }
            // }
        }, 5000, addr, txHash);
    });
    let utxo = await p;
    if (!utxo) {
        if (slots <= 0) {
            throw ('Timeout');
        } else {
            utxo = await this.waitTxConfirmed(addr, txHash, slots - 1);
        }
    }
    return utxo;

}

module.exports.submitTx = async function (signedTx) {
    if (interVia == 'ogmios') {
        return await txSubmitclient.submitTx(Buffer.from(signedTx.to_bytes()).toString('hex'));

    } else {
        throw 'Not Support BlockFrostApi'
        // return await blockFrostApi.txSubmit(signedTx.to_bytes());
    }

}

/**
 * //just for local test
 * @param {*} skey private key in hex
 * @param {*} hash the data hash to be signed
 * @returns 
 */
module.exports.signFn = (skey, hash) => {
    const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(Buffer.from(skey, 'hex'));
    const signature = payPrvKey.sign(Buffer.from(hash, 'hex')).to_hex();
    const vkey = payPrvKey.to_public().to_bech32();
    return { vkey, signature };
}

module.exports.init_ogmios = async function (hostServer = { host: '127.0.0.1', port: 1337, tls: false}) {
    let host = '127.0.0.1';
    let port = 1337;
    let tls = false;
    let apiKey = undefined;
    if (hostServer) {
        if (hostServer.host) host = hostServer.host;
        if (hostServer.port) port = hostServer.port;
        if (hostServer.tls) tls = hostServer.tls;
    }
    context = await createInteractionContext(errorHandler, closeHandler, { connection: { host, port, tls }, interactionType: 'LongRunning' });
    txSubmitclient = await createTxSubmissionClient(context);
    query = await createStateQueryClient(context);
    const blockHeight = await query.blockHeight();
    // console.log(blockHeight);
    // const ss = await this.getUtxo('addr_test1qz6twkzgss75sk379u0e27phvwhmtqqfuhl5gnx7rh7nux2xg4uwrhx9t58far8hp3a06hfdfzlsxgfrzqv5ryc78e4s4dwh26')
    // console.log(blockHeight);
    // // context.socket.close()
    // const fd = await query.eraStart();
    // const soltConfig = await query.eraSummaries();
    // const tips = await query.chainTip();
    // const genisis = await query.genesisConfig();

    // console.log('===>',this.soltToTimestamp(28180867,soltConfig,genisis));
}
//eb1905f4b011bc3412d65a1977668abbe4fa3538d3bd4e828076d64d
module.exports.getdelegationsAndRewards = async function (stakeKeyHash) {
    const infos = await query.delegationsAndRewards([stakeKeyHash]);
    return infos[stakeKeyHash];
}

module.exports.currentNetworkSlotToTimestamp = async function (slot) {
    const eraSummaries = await query.eraSummaries();
    const genisis = await query.genesisConfig();

    return this.soltToTimestamp(slot, eraSummaries, genisis);
}

module.exports.soltToTimestamp = function (slot, eraSummaries, genisis) {

    // const slotConfig = await query.eraSummaries(); 
    const earIndex = function (slot, slotConfig) {
        for (let i = 0; i < slotConfig.length; i++) {
            const ear = slotConfig[i];
            if (slot >= ear.start.slot && slot <= ear.end.slot) return i;
            if (slot > ear.end.slot) continue;
            if (slot < ear.end.slot) {
                throw `Bad slot ${slot}`;
            }
        }

        throw `Bad slot ${slot}`;
    }

    let sysStartTimeStamp = Date.parse(genisis.systemStart);
    const earIndeNumber = earIndex(slot, eraSummaries);
    const targetEar = eraSummaries[earIndeNumber];
    // console.log(JSON.stringify(eraSummaries));
    // for (let i = 0; i < eraSummaries.length; i++) {
    //     const ear = eraSummaries[i];
    //     // sysStartTimeStamp += ear.time + ear.
    // } 1683864067000 - 1654041600000 - 5184000
    return sysStartTimeStamp + targetEar.start.time * 1000 + (slot - targetEar.start.slot) * targetEar.parameters.slotLength * 1000

}

module.exports.getLastestSolt = async function () {
    const a = await query.chainTip();
    return a.slot;
}

module.exports.unInit = async function () {
    context.socket.close();
}

module.exports.evaluateTx = async (signedTx) => {
    try {
        const cost = await TxSubmission.evaluateTx(context, signedTx.to_hex());
        // console.log(JSON.stringify(cost));
        return cost;
    } catch (e) {
        console.error(e);
        for (let i = 0; i < e.length; i++) {
            const err = e[i];
            console.error(err.stack);
        }
    }
}

module.exports.evaluate = async (signedTxRaw) => {
    try {
        const cost = await TxSubmission.evaluateTx(context, signedTxRaw);
        // console.log(JSON.stringify(cost));
        return cost;
    } catch (e) {
        console.error(e);
        for (let i = 0; i < e.length; i++) {
            const err = e[i];
            console.error(err.stack);
        }
    }
}


module.exports.fixTxExuintByEvaluate = async function (protocolParams, txRaw, collateralUtxos, gasMutipl = 1) {
    const exUnitEVA = await this.evaluate(txRaw);

    let total_ex_mem = 0;
    let total_ex_cpu = 0;

    for (const key in exUnitEVA) {
        const exUnit = exUnitEVA[key];
        total_ex_mem += Math.floor(exUnit.memory * gasMutipl);
        total_ex_cpu += Math.floor(exUnit.steps * gasMutipl);
    }

    if (protocolParams.maxExecutionUnitsPerTransaction.memory < total_ex_mem || protocolParams.maxExecutionUnitsPerTransaction.steps < total_ex_cpu) {
        throw `ExUnit too large: memory:${total_ex_mem} ,steps:${total_ex_cpu}`;
    }
    let tx = CardanoWasm.Transaction.from_hex(txRaw);
    let witnessSset;
    {
        if (tx.witness_set()) {
            witnessSset = tx.witness_set();
        } else {
            witnessSset = CardanoWasm.TransactionWitnessSet.new();
        }

        let vks = witnessSset.vkeys();
        if (!vks) {
            vks = CardanoWasm.Vkeywitnesses.new();
        }
        let aa = tx.body().required_signers().len();
        let bb = vks.len();

        for (let i = aa - bb; i > 0; i--) {
            const vk = CardanoWasm.Vkeywitness.new(
                CardanoWasm.Vkey.new(CardanoWasm.PublicKey.from_hex('cbc623254ca1eb30d8cb21b2ef04381372ff24539a74e4b5117d1e3bbb0f0188')),
                CardanoWasm.Ed25519Signature.from_hex('b31d2a51199f1c47f1d3f10e7a4b68bf717ded8d8e0346b8d37a2e44a02088ac62f6ea82b0b13fda81da242c92def5b5fadb3e7e16459897f000b1bd4e09a30b')
            );
            vks.add(vk);
            // console.log('*******2', vks.to_json());
        }
        witnessSset.set_vkeys(vks);

        tx = CardanoWasm.Transaction.new(
            tx.body(), witnessSset, tx.auxiliary_data()
        )
        // console.log('&&&&&&&2', tx.to_json());
    }
    const redeemers = witnessSset.redeemers();
    const redeemersNew = CardanoWasm.Redeemers.new();
    for (let i = 0; i < redeemers.len(); i++) {
        const redeemer = redeemers.get(i);
        const tag = redeemer.tag();
        const index = redeemer.index();
        const redeemerData = redeemer.data();

        let tagStr = '';
        switch (tag.kind()) {
            case CardanoWasm.RedeemerTagKind.Spend:
                tagStr = 'spend:' + index.to_str();
                break;
            case CardanoWasm.RedeemerTagKind.Mint:
                tagStr = 'mint:' + index.to_str();
                break;
            case CardanoWasm.RedeemerTagKind.Cert:
                tagStr = 'cert:' + index.to_str();
                break;
            case CardanoWasm.RedeemerTagKind.Reward:
                tagStr = 'reward:' + index.to_str();
                break;
            default:
                break;
        }
        let ex_unit_mem = Math.floor(exUnitEVA[tagStr].memory * gasMutipl);
        let ex_unit_cpu = Math.floor(exUnitEVA[tagStr].steps * gasMutipl);
        const exUint = CardanoWasm.ExUnits.new(CardanoWasm.BigNum.from_str(ex_unit_mem + ''), CardanoWasm.BigNum.from_str(ex_unit_cpu + ''));

        const redeemerNew = CardanoWasm.Redeemer.new(
            tag, index, redeemerData, exUint
        );
        redeemersNew.add(redeemerNew);
    }


    const memPriceParams = protocolParams.prices.memory.split('/');
    const stepPriceParams = protocolParams.prices.steps.split('/');

    const exUnitPrice = CardanoWasm.ExUnitPrices.new(
        CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(memPriceParams[0]), CardanoWasm.BigNum.from_str(memPriceParams[1]))
        , CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(stepPriceParams[0]), CardanoWasm.BigNum.from_str(stepPriceParams[1])));

    const totalExUnits = CardanoWasm.ExUnits.new(CardanoWasm.BigNum.from_str(total_ex_mem + ''), CardanoWasm.BigNum.from_str(total_ex_cpu + ''));
    const plutusCost = CardanoWasm.calculate_ex_units_ceil_cost(totalExUnits, exUnitPrice);

    const txfeeWithoutPlutus = CardanoWasm.BigNum.from_str('' + protocolParams.minFeeCoefficient).checked_mul(
        CardanoWasm.BigNum.from_str('' + tx.to_bytes().byteLength)
    ).checked_add(CardanoWasm.BigNum.from_str('' + protocolParams.minFeeConstant));

    const total_fee = plutusCost.checked_add(txfeeWithoutPlutus);
    // console.log('txfeeWithoutPlutus=', txfeeWithoutPlutus.to_str());
    // console.log('plutusCost=', plutusCost.to_str());
    // console.log('total_fee=', total_fee.to_str());

    const newBody = CardanoWasm.TransactionBody.new(tx.body().inputs(), tx.body().outputs(), total_fee, tx.body().ttl());
    if (tx.body().auxiliary_data_hash()) newBody.set_auxiliary_data_hash(tx.body().auxiliary_data_hash());
    if (tx.body().certs()) newBody.set_certs(tx.body().certs());

    let collaterOwnerAddress;
    const txCollateralInputBuilder = CardanoWasm.TxInputsBuilder.new();
    for (let i = 0; i < collateralUtxos.length; i++) {
        const utxoCollateral = collateralUtxos[i];
        const txId = CardanoWasm.TransactionHash.from_bytes(Buffer.from(utxoCollateral.txHash, 'hex'));
        const input = CardanoWasm.TransactionInput.new(txId, utxoCollateral.index);
        // const value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(utxoCollateral.value + ''));
        const value = utils.funValue(utxoCollateral.value);
        const from = CardanoWasm.Address.from_bech32(utxoCollateral.address);
        collaterOwnerAddress = from;
        txCollateralInputBuilder.add_regular_input(from, input, value);
    }
    newBody.set_collateral(txCollateralInputBuilder.inputs());


    const totalCollateraInputlValue = txCollateralInputBuilder.total_value();
    const collateralValue = CardanoWasm.Value.new(total_fee.checked_mul(CardanoWasm.BigNum.from_str('2')));
    const collateralReturnValue = totalCollateraInputlValue.checked_sub(collateralValue);
    const collateralOutput = CardanoWasm.TransactionOutput.new(collaterOwnerAddress, collateralReturnValue);

    newBody.set_collateral_return(collateralOutput);
    newBody.set_reference_inputs(tx.body().reference_inputs());
    newBody.set_required_signers(tx.body().required_signers());

    const costModesLib = protocolParams.costModels;//getCostModels(protocolParams);
    const tmp = CardanoWasm.Costmdls.new();
    tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
    const hash = CardanoWasm.hash_script_data(redeemersNew, tmp);
    newBody.set_script_data_hash(hash);
    if (tx.body().update()) newBody.set_update(tx.body().update());
    if (tx.body().validity_start_interval()) newBody.set_validity_start_interval(tx.body().validity_start_interval());
    if (tx.body().validity_start_interval_bignum()) newBody.set_validity_start_interval_bignum(tx.body().validity_start_interval_bignum());

    if (tx.body().withdrawals()) newBody.set_withdrawals(tx.body().withdrawals());
    if (tx.body().network_id()) newBody.set_network_id(tx.body().network_id());
    if (tx.body().mint()) newBody.set_mint(tx.body().mint());
    if (tx.body().auxiliary_data_hash()) newBody.set_auxiliary_data_hash(tx.body().auxiliary_data_hash());

    witnessSset.set_redeemers(redeemersNew);
    if (tx.witness_set().plutus_data()) witnessSset.set_plutus_data(tx.witness_set().plutus_data());
    {
        const tmptx = CardanoWasm.Transaction.from_hex(txRaw);
        if (tmptx.witness_set().vkeys()) {
            witnessSset.set_vkeys(tmptx.witness_set().vkeys());
        } else {
            witnessSset.set_vkeys(CardanoWasm.Vkeywitnesses.new());
        }
    }

    if (tx.witness_set().plutus_scripts()) witnessSset.set_plutus_scripts(tx.witness_set().plutus_scripts());
    if (tx.witness_set().bootstraps()) witnessSset.set_bootstraps(tx.witness_set().bootstraps());
    if (tx.witness_set().native_scripts()) witnessSset.set_native_scripts(tx.witness_set().native_scripts());

    const newTx = CardanoWasm.Transaction.new(newBody, witnessSset, tx.auxiliary_data());
    return newTx;
}