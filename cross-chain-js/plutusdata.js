const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const utils = require('./utils');

//type: 0: pubkey 1: scripthash 2: pointer
// const TYP_PUBKEY = 0;
// const TYP_SCRHASH = 1;
// const TYPE_PTR = 2;
module.exports.TYP_PUBKEY = 0;
module.exports.TYP_SCRHASH = 1;
module.exports.TYPE_PTR = 2;

module.exports.toPlutusDataTxId = function (txHash) {
    const ls = CardanoWasm.PlutusList.new();
    ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(txHash, 'hex')));

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.toPlutusDataTxOutRef = function (txHash, index) {
    const ls = CardanoWasm.PlutusList.new();

    ls.add(this.toPlutusDataTxId(txHash));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(index + '')));

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.toPlutusDataOutputReference_aiken = function (txHash, index) {
    const ls = CardanoWasm.PlutusList.new();

    ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(txHash, 'hex')));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(index + '')));

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.OutputReference_aikenFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();

    const txHash = Buffer.from(ls.get(0).as_bytes()).toString('hex');
    const index = ls.get(0).as_integer().to_str()*1;
    return { txHash, index };
}

module.exports.txIdFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();

    const txHash = Buffer.from(ls.get(0).as_bytes()).toString('hex');
    return txHash;
}

module.exports.txOutRefFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();
    const txId = ls.get(0).as_constr_plutus_data();
    const txHash = this.txIdFromCbor(txId.to_hex());//Buffer.from(txId.get(0).as_bytes()).toString('hex');
    const index = ls.get(1).as_integer().to_str() * 1;

    return { txHash, index };
}

module.exports.toPlutusDataCredential = function (type, pkhOrSh) {
    const ls = CardanoWasm.PlutusList.new();
    ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(pkhOrSh, 'hex')));
    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str(type + ''),
            ls
        )
    )
}

module.exports.credentialFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();
    const hash = ls.get(0).as_bytes();
    switch (d.as_constr_plutus_data().alternative().to_str()) {
        case '0': {
            return CardanoWasm.Credential.from_keyhash(CardanoWasm.Ed25519KeyHash.from_bytes(hash));
            break;
        }
        case '1': {
            return CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_bytes(hash));
            break;
        }
        default:
            break;
    }
}

module.exports.toPlutusDataStakeHash = function (type, pkhOrSh) {
    const ls = CardanoWasm.PlutusList.new();

    ls.add(this.toPlutusDataCredential(type, pkhOrSh));
    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.stakeHashFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    // console.log(d.to_json())
    const stakeHash = d.as_constr_plutus_data();

    const stkls = stakeHash.data();
    const hash = stkls.get(0).as_bytes();
    switch (stakeHash.alternative().to_str()) {
        case '0': {//keyhash
            return CardanoWasm.Credential.from_keyhash(CardanoWasm.Ed25519KeyHash.from_bytes(hash));
            break;
        }
        case '1': {//scripthash
            return CardanoWasm.Credential.from_scripthash(CardanoWasm.ScriptHash.from_bytes(hash));
            break;
        }

        default:
            throw 'bad cbor data'
            break;
    }
}

module.exports.toPlutusDataPointer = function (solt, tx_index, cert_index) {
    const ls = CardanoWasm.PlutusList.new();

    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(solt + '')));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(tx_index + '')));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(cert_index + '')));
    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('1'),
            ls
        )
    )
}

module.exports.pointerFromCbor = function (cbor) { }

module.exports.toPlutusDataStakeCredential = function (type, pkhOrSh) {
    const ls = CardanoWasm.PlutusList.new();

    if (!pkhOrSh) {
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('1'),
                ls
            )
        )
    }


    switch (type) {
        case 0:
        case 1: {
            ls.add(this.toPlutusDataStakeHash(type, pkhOrSh));
            return CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    ls
                )
            )
            break;
        }
        case 2: {
            ls.add(this.toPlutusDataPointer(...pkhOrSh));
            return CardanoWasm.PlutusData.new_constr_plutus_data(
                CardanoWasm.ConstrPlutusData.new(
                    CardanoWasm.BigNum.from_str('0'),
                    ls
                )
            )
            break;
        }

        default:
            throw 'bad type: ' + type;
    }


}

module.exports.stakeCredentialFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    // console.log(d.to_json());
    if (!d.as_constr_plutus_data().alternative().is_zero()) return;

    const ls = d.as_constr_plutus_data().data();

    const stakeCredential = ls.get(0).as_constr_plutus_data();
    switch (stakeCredential.alternative().to_str()) {
        case '0': {// stakehash
            return this.stakeHashFromCbor(stakeCredential.data().get(0).to_hex());
            break;
        }
        case '1': { //ptr
            throw 'not implemented';
            break;
        }
        default:
            throw 'bad cbor data'
            break;
    }

}


module.exports.toPlutusDataAddress = function (address) {
    const ls = CardanoWasm.PlutusList.new();

    const addressCode = utils.addressTypeCode(address);
    switch (addressCode) {
        case '0': {//0000: base address: keyhash28,keyhash28
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.BaseAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_keyhash().to_hex();
            const stake = addrObj.stake_cred().to_keyhash().to_hex();

            ls.add(this.toPlutusDataCredential(0, payment));
            ls.add(this.toPlutusDataStakeCredential(0, stake));
            break;
        }
        case '1': {//0001: base address: scripthash28,keyhash28
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.BaseAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_scripthash().to_hex();
            const stake = addrObj.stake_cred().to_keyhash().to_hex();

            ls.add(this.toPlutusDataCredential(1, payment));
            ls.add(this.toPlutusDataStakeCredential(0, stake));
            break;
        }
        case '2': {//0010: base address: keyhash28,scripthash28
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.BaseAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_keyhash().to_hex();
            const stake = addrObj.stake_cred().to_scripthash().to_hex();

            ls.add(this.toPlutusDataCredential(0, payment));
            ls.add(this.toPlutusDataStakeCredential(1, stake));
            break;
        }
        case '3': {//0011: base address: scripthash28,scripthash28
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.BaseAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_scripthash().to_hex();
            const stake = addrObj.stake_cred().to_scripthash().to_hex();

            ls.add(this.toPlutusDataCredential(1, payment));
            ls.add(this.toPlutusDataStakeCredential(1, stake));
            break;
        }
        case '4': {//0100: pointer address: keyhash28, 3 variable length uint
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.PointerAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_keyhash().to_hex();
            const slot = addrObj.stake_pointer().slot();
            const tx_index = addrObj.stake_pointer().tx_index();
            const cert_index = addrObj.stake_pointer().cert_index();

            ls.add(this.toPlutusDataCredential(0, payment));
            ls.add(this.toPlutusDataStakeCredential(2, [slot, tx_index, cert_index]));
            break;
        }
        case '5': {//0101: pointer address: scripthash28, 3 variable length uint
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.PointerAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_scripthash().to_hex();
            const slot = addrObj.stake_pointer().slot();
            const tx_index = addrObj.stake_pointer().tx_index();
            const cert_index = addrObj.stake_pointer().cert_index();

            ls.add(this.toPlutusDataCredential(1, payment));
            ls.add(this.toPlutusDataPointer(slot, tx_index, cert_index));
            break;
        }
        case '6': {//0110: enterprise address: keyhash28
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.EnterpriseAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_keyhash().to_hex();

            ls.add(this.toPlutusDataCredential(0, payment));
            ls.add(this.toPlutusDataStakeCredential(0, undefined));
            break;
        }
        case '7': {//0111: enterprise address: scripthash28
            const addr = CardanoWasm.Address.from_bech32(address);
            let addrObj = CardanoWasm.EnterpriseAddress.from_address(addr);
            const payment = addrObj.payment_cred().to_scripthash().to_hex();

            ls.add(this.toPlutusDataCredential(1, payment));
            ls.add(this.toPlutusDataStakeCredential(1, undefined));
            break;
        }
        case '8': {//1000: byron address
            // const addr = CardanoWasm.Address.from_bech32(address);
            // let addrObj = CardanoWasm.ByronAddress.from_address(addr);
            // throw 'not support address type: '+ addressCode;
            // break;
        }
        case 'e': {//1110: reward account: keyhash28
            // break;
        }
        case 'f': {//1111: reward account: scripthash28
            // break;
        }
        case '9': {//1001 - 1101: future formats
            throw 'not support address type: ' + addressCode;
            // break;
        }

        default:
            throw 'not support address type: ' + addressCode;
            break;
    }

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.addressFromCbor = function (cbor, networkId) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();
    // const payment_credCbor = ls.get(0).as_constr_plutus_data();
    const payment_cred = this.credentialFromCbor(ls.get(0).as_constr_plutus_data().to_hex());
    const stake_cred = this.stakeCredentialFromCbor(ls.get(1).as_constr_plutus_data().to_hex());

    let retAddr;
    if (stake_cred) {
        const baseAddr = CardanoWasm.BaseAddress.new(networkId * 1, payment_cred, stake_cred);
        retAddr = baseAddr.to_address();
    } else {
        const enterpriseAddr = CardanoWasm.EnterpriseAddress.new(networkId * 1, payment_cred);
        retAddr = enterpriseAddr.to_address();
    }

    return retAddr.to_bech32(networkId * 1 === 0 ? 'addr_test' : 'addr');
}

module.exports.DATUMTYP_NO = 0;
module.exports.DATUMTYP_HASH = 1;
module.exports.DATUMTYP_DATUM = 2;

module.exports.toPlutusDataOutputDatum = function (datumType, datumOrHash) {
    const ls = CardanoWasm.PlutusList.new();

    switch (datumType) {
        case this.DATUMTYP_NO: {

            break;
        }
        case this.DATUMTYP_HASH: {
            ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(datumOrHash, 'hex')))
            break;
        }
        case this.DATUMTYP_DATUM: {
            ls.add(CardanoWasm.PlutusData.from_hex(datumOrHash));
            break;
        }

        default:
            throw 'bad datum type: ' + datumType;
            break;
    }

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str(datumType + ''),
            ls
        )
    )
}

module.exports.outputDatumFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const datumOrHash = d.as_constr_plutus_data();
    switch (datumOrHash.alternative().to_str()) {
        case '0': {
            return;
            break;
        }
        case '1': {
            const dHash = Buffer.from(datumOrHash.data().get(0).as_bytes()).toString('hex');
            return { datumType: 1, datumOrHash: dHash }
            break;
        }
        case '2': {
            const dHash = datumOrHash.data().get(0).to_hex();
            return { datumType: 2, datumOrHash: dHash }
            break;
        }
        default:
            throw 'bad datum'
            break;
    }
}

module.exports.toPlutusDataValue = function (funValue) {
    const value = utils.funValue(funValue);
    // console.log(value.to_json());

    const plutusmap = CardanoWasm.PlutusMap.new();
    if (!value.coin().is_zero()) {
        const assetData = CardanoWasm.PlutusMap.new();
        const plutuMapValues1 = CardanoWasm.PlutusMapValues.new();
        plutuMapValues1.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(value.coin().to_str())));
        assetData.insert(
            CardanoWasm.PlutusData.new_bytes(Buffer.from('', 'hex'))
            // , CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(value.coin().to_str()))
            , plutuMapValues1
        );
        // plutusmap.insert(CardanoWasm.PlutusData.new_bytes(Buffer.from('', 'hex')), CardanoWasm.PlutusData.new_map(assetData));
        const plutuMapValues2 = CardanoWasm.PlutusMapValues.new();
        plutuMapValues2.add(CardanoWasm.PlutusData.new_map(assetData));
        plutusmap.insert(CardanoWasm.PlutusData.new_bytes(Buffer.from('', 'hex')), plutuMapValues2);
    }

    const assetmap = value.multiasset()
    if (assetmap) {
        for (let i = 0; i < assetmap.keys().len(); i++) {
            const policyId = assetmap.keys().get(i);
            const assetData = CardanoWasm.PlutusMap.new();

            for (let j = 0; j < assetmap.get(policyId).keys().len(); j++) {
                const assetName = assetmap.get(policyId).keys().get(j);
                const amount = assetmap.get_asset(policyId, assetName);
                const tmp = CardanoWasm.PlutusMapValues.new();
                tmp.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(amount.to_str())))
                assetData.insert(
                    CardanoWasm.PlutusData.new_bytes(assetName.name())
                    , tmp)
            }

            const mapValues = CardanoWasm.PlutusMapValues.new();
            mapValues.add(CardanoWasm.PlutusData.new_map(assetData));
            plutusmap.insert(
                CardanoWasm.PlutusData.new_bytes(Buffer.from(policyId.to_hex(), 'hex'))
                , mapValues);
        }
    }


    return CardanoWasm.PlutusData.new_map(plutusmap);

}

module.exports.valueFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const valueMap = d.as_map();
    let ret = { assets: {} };
    for (let i = 0; i < valueMap.keys().len(); i++) {
        const policyId = valueMap.keys().get(i);
        const assets = valueMap.get(policyId).get(0);
        for (let j = 0; j < assets.as_map().keys().len(); j++) {
            const name = assets.as_map().keys().get(j);
            const value = assets.as_map().get(name).get(0).as_integer().to_str();
            if (policyId.as_bytes().length == 0) {
                ret.coins = value;
            } else {
                const p = Buffer.from(policyId.as_bytes()).toString('hex');
                const n = Buffer.from(name.as_bytes()).toString('hex');
                ret.assets[p + '.' + n] = value;
            }
        }
    }

    return ret;
}


module.exports.toPlutusDataMsgAddress = function (address) {
    const ls = CardanoWasm.PlutusList.new();
    let addressType = '1';
    try {
        // if(address === 'addr_test1wpunlryvl7aqsxe22erzlsseej87v5kk5vutvtrmzdy8dect48z0w')
        ls.add(this.toPlutusDataAddress(address));
    } catch (error) {
        ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(address, 'ascii')));
        addressType = '0';
    }


    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str(addressType),
            ls
        )
    )
}

module.exports.msgAddressFromCbor = function (cbor, networkId) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const addressType = d.as_constr_plutus_data().alternative().to_str();
    switch (addressType) {
        case '0': {
            const foreinAddr = d.as_constr_plutus_data().data().get(0).as_bytes();
            return Buffer.from(foreinAddr).toString('ascii');
        }
        case '1': {
            const localAddr = d.as_constr_plutus_data().data().get(0).as_constr_plutus_data();
            return this.addressFromCbor(localAddr.to_hex(), networkId);
            break;
        }
        case '1': {

        }
    }
    const ls = d.as_constr_plutus_data().data().as_list();
    return ls.get(0).to_hex();
}

module.exports.toPlutusDataFunctionCallData = function (functionCallData) {
    const ls = CardanoWasm.PlutusList.new();
    ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(functionCallData.functionName, 'ascii')));
    ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(functionCallData.functionArgs, 'hex')));

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.functionCallDataFromCbor = function (cbor) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();
    const ret = {
        functionName: Buffer.from(ls.get(0).as_bytes()).toString('ascii'),
        functionArgs: Buffer.from(ls.get(1).as_bytes()).toString('hex')
    }
    return ret;
}

module.exports.toPlutusDataCrossMsgData = function (inBoundData) {
    const ls = CardanoWasm.PlutusList.new();
    ls.add(CardanoWasm.PlutusData.new_bytes(Buffer.from(inBoundData.taskId, 'ascii')));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(inBoundData.sourceChainId + '')));
    ls.add(this.toPlutusDataMsgAddress(inBoundData.sourceContract));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(inBoundData.targetChainId + '')));
    ls.add(this.toPlutusDataMsgAddress(inBoundData.targetContract));
    ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(inBoundData.gasLimit + '')));
    ls.add(this.toPlutusDataFunctionCallData(inBoundData.functionCallData));

    return CardanoWasm.PlutusData.new_constr_plutus_data(
        CardanoWasm.ConstrPlutusData.new(
            CardanoWasm.BigNum.from_str('0'),
            ls
        )
    )
}

module.exports.crossMsgDataFromCbor = function (cbor, networkId) {
    const d = CardanoWasm.PlutusData.from_hex(cbor);
    const ls = d.as_constr_plutus_data().data();
    const taskId = Buffer.from(ls.get(0).as_bytes()).toString('ascii');
    const sourceChainId = ls.get(1).as_integer().to_str();
    const sourceContract = this.msgAddressFromCbor(ls.get(2).to_hex(), networkId);
    const targetChainId = ls.get(3).as_integer().to_str();
    const targetContract = this.msgAddressFromCbor(ls.get(4).to_hex(), networkId);
    const gasLimit = ls.get(5).as_integer().to_str();
    const functionCallData = this.functionCallDataFromCbor(ls.get(6).to_hex());
    const ret = {
        taskId,
        sourceChainId,
        sourceContract,
        targetChainId,
        targetContract,
        gasLimit,
        functionCallData
    }
    return ret;
}