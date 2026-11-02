

const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const secp256k1 = require('secp256k1');
const config = require("../config");

class CommonUtil {

    constructor(addrPrefix) {
        this.ADDR_PREFIX = addrPrefix;
    }

    number2String(value) {

        if (typeof value === 'string') {
            return value;
        } else {
            return value.toString();
        }
    }

    byteArray2Hexstring(byteArray) {
        return Array.from(byteArray, function (byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        }).join('')
    }

    encodeGpk(strGpk) {
        let gpkXY = strGpk.replace("0x", "04");
        let gpk = Buffer.from(secp256k1.publicKeyConvert(Buffer.from(gpkXY, 'hex'), true)).toString('hex');

        return gpk;
    }

    ascii2Hex(str) {
        let hexStr = [];
        for (let n = 0; n < str.length; n++) {
            let hex = Number(str.charCodeAt(n)).toString(16);
            hexStr.push(hex);
        }
        return hexStr.join('');
    }

    hexStr2Ascii(hexString) {
        let hex = hexString.toString();
        let str = '';
        for (let n = 0; n < hex.length; n += 2) {
            str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
        }
        return str;
    }

    buildBallancedTxMetaDataByJson(operationType) {
        let itemValue = {
            "type": operationType,
            "uniqueId": 0
        };

        let obj = {
            5718350: itemValue
        }

        let metadata = CardanoWasm.encode_json_str_to_metadatum(JSON.stringify(obj), CardanoWasm.MetadataJsonSchema.BasicConversions);
        return metadata;
    }

    quot(iValueA, iValueB) {
        let quotRslt = Math.floor(iValueA / iValueB);
        return quotRslt;
    }

    roundupBytesToWords(bytesValue) {
        let rslt = this.quot(bytesValue + 7, 8);
        return rslt;
    }

    deriveAddress(hashPayPrvkey, hashStakePrvKey) {

        let networkId = CardanoWasm.NetworkInfo.testnet_preprod().network_id();
        if (config.PlutusCfg.mainnetPrefix === this.ADDR_PREFIX) {
            networkId = CardanoWasm.NetworkInfo.mainnet().network_id();
        }

        const payPrvKey = CardanoWasm.PrivateKey.from_normal_bytes(cbor.decodeFirstSync(hashPayPrvkey));
        console.log('\n\n *******CBOR payPrvKey:', payPrvKey.to_bech32());

        const stakePrvKey = CardanoWasm.PrivateKey.from_normal_bytes(cbor.decodeFirstSync(hashStakePrvKey));
        console.log('\n\n *******CBOR stakePrvKey:', stakePrvKey.to_bech32());

        const addressFromPrvKey = CardanoWasm.BaseAddress.new(networkId,
            CardanoWasm.Credential.from_keyhash(payPrvKey.to_public().hash()),
            CardanoWasm.Credential.from_keyhash(stakePrvKey.to_public().hash())
        );

        const addressBech32Prvkey = addressFromPrvKey.to_address().to_bech32();
        console.log("\n\n *******addressBech32Prvkey: ", addressBech32Prvkey);

        return addressBech32Prvkey;
    }

    caculateMinBoundAdaValueByTokenUnit(tokenId) {
        let [policyId, tokenName] = tokenId.split(".");

        let asciiName = this.hexStr2Ascii(tokenName);
        sumAssetNameLengths = asciiName.length;

        // in case of token assets
        let multiAssetInfo = {
            "numAssets": 1,
            "numPids": 1,
            "sumAssetNameLengths": sumAssetNameLengths
        }
        let boundAdaAmount = CardanoWasm.BigNum.from_str(this.caculateMinAdaValue(multiAssetInfo));
        return boundAdaAmount;
    }

    caculateMinAdaValue(u, coinsPerUtxoWord) {
        const coinSize = 2;
        const utxoEntrySizeWithoutVal = 27;
        const adaOnlyUTxOSize = utxoEntrySizeWithoutVal + coinSize;
        const pidSize = 28;

        //this.coinsPerUtxoWord = 37037;// 
        const minUTxOValue = coinsPerUtxoWord * adaOnlyUTxOSize;

        let numAssets = u.numAssets;
        let numPids = u.numPids;
        let sumAssetNameLengths = u.sumAssetNameLengths;
        let sizeBound = 6 + this.roundupBytesToWords((numAssets * 12) + sumAssetNameLengths + (numPids * pidSize));
        let utxoBoundValue = coinsPerUtxoWord * (utxoEntrySizeWithoutVal + sizeBound);

        if (parseInt(minUTxOValue) > parseInt(utxoBoundValue)) {
            return JSON.stringify(minUTxOValue);
        }

        return JSON.stringify(utxoBoundValue);
    }

    buildTokenAsset(tokenName, tokenAmount) {

        let assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
        let tokenValue = CardanoWasm.BigNum.from_str(this.number2String(tokenAmount));

        let tokenAsset = CardanoWasm.Assets.new();
        tokenAsset.insert(assetName, tokenValue);

        return tokenAsset;
    }

    buildMultiAsset(tokenObjAry, boundAdaAmount) {

        let multiAssetObj = CardanoWasm.MultiAsset.new();
        for (let i = 0; i < tokenObjAry.length; i++) {
            let tokenObj = tokenObjAry[i];
            // console.log("\n\n..buildMultiAsset: ", tokenObj);

            let tokenPolicyID = tokenObj.unit;
            let tokenName = tokenObj.name;
            let tokenAmount = tokenObj.amount;

            // let tokenAsset = CardanoWasm.Assets.new();
            let assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));
            let tokenValue = CardanoWasm.BigNum.from_str(this.number2String(tokenAmount));
            // tokenAsset.insert(assetName, tokenValue);
            let tokenSriptHash = CardanoWasm.ScriptHash.from_bytes(Buffer.from(tokenPolicyID, "hex"));
            // multiAssetObj.insert(tokenSriptHash, tokenAsset);
            multiAssetObj.set_asset(tokenSriptHash, assetName, tokenValue);
        }



        let baseAdaValue = CardanoWasm.BigNum.from_str(this.number2String(boundAdaAmount));
        let multAssetValue = CardanoWasm.Value.new(baseAdaValue);
        multAssetValue.set_multiasset(multiAssetObj);

        return multAssetValue;
    }

    encodeUtxo(formatUtxo) {
        let txInData = formatUtxo.txIn;
        let txOutData = formatUtxo.txOut;

        let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(txInData.txId, 'hex'));
        let txInput = CardanoWasm.TransactionInput.new(transaction_id, txInData.index);
        let address = CardanoWasm.Address.from_bech32(txOutData.address);

        let amount = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(this.number2String(txOutData.value[0].quantity)));
        if (1 < txOutData.value.length) {
            let multiAssetObj = CardanoWasm.MultiAsset.new();
            for (let i = 1; i < txOutData.value.length; i++) {

                let strScriptHash = txOutData.value[i].unit.slice(0, 56);
                let strName = txOutData.value[i].unit.slice(56);

                let tokenAsset = this.buildTokenAsset(strName, txOutData.value[i].quantity);
                let tokenSriptHash = CardanoWasm.ScriptHash.from_bytes(Buffer.from(strScriptHash, "hex"));
                multiAssetObj.insert(tokenSriptHash, tokenAsset);
            }
            amount.set_multiasset(multiAssetObj);
        }

        let txOutput = CardanoWasm.TransactionOutput.new(address, amount);
        let encodedUtxo = CardanoWasm.TransactionUnspentOutput.new(txInput, txOutput);

        return encodedUtxo;
    }

    getMinAdaOfUtxo(protocolParams, owner, value, datum, refScript) {

        const mutiAsset = CardanoWasm.MultiAsset.new();
        let checkedValue = value;

        if (!(value instanceof CardanoWasm.Value)) {

            if (!value.assets) value.assets = {};

            for (const tokenId in value.assets) {
                let policy_id = undefined;
                let tokenName = undefined;
                if (-1 === tokenId.indexOf('.')) {
                    policy_id = tokenId.substring(0, 56);
                    tokenName = tokenId.substring(56);
                } else {
                    [policy_id, tokenName] = tokenId.split('.');

                }
                // console.log("\n..getMinAdaOfUtxo...token info: ", policy_id, tokenName);
                const assetName = CardanoWasm.AssetName.new(Buffer.from(tokenName, 'hex'));

                let asset = mutiAsset.get(CardanoWasm.ScriptHash.from_hex(policy_id));
                if (!asset) asset = CardanoWasm.Assets.new();
                asset.insert(assetName, CardanoWasm.BigNum.from_str('' + value.assets[tokenId]));
                mutiAsset.insert(CardanoWasm.ScriptHash.from_hex(policy_id), asset);
            }

            //const minAdaWithToken = 1000000 + 1 * value.coins;//1672280        
            const minAdaWithToken = 1000000 + 1 * (value.coins ? value.coins : 0);//1672280            
            checkedValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(minAdaWithToken + ''));
            checkedValue.set_multiasset(mutiAsset);

        } else {
            // if (value.coin().is_zero) value.set_coin(CardanoWasm.BigNum.from_str('1000000'));
            // console.log(value.to_json());
            if (value.coin().less_than(CardanoWasm.BigNum.from_str('1000000'))) {
                // console.log('=====>',value.coin().to_str());
                value.set_coin(CardanoWasm.BigNum.from_str('1000000'));
            }
        }

        let ownerAddr = owner;
        if (!(owner instanceof CardanoWasm.Address)) {
            try {
                ownerAddr = CardanoWasm.Address.from_bech32(owner);
            } catch (e) {
                console.error("Invalid owner! err: ", e);
                throw e;
            }
        }

        const output = CardanoWasm.TransactionOutput.new(ownerAddr, checkedValue);

        if (datum) output.set_plutus_data(datum);

        if (refScript) {
            output.set_script_ref(CardanoWasm.ScriptRef.new_plutus_script(refScript));
        }

        return (160 + output.to_bytes().byteLength) * protocolParams.coinsPerUtxoByte;
    }

    buildOutputValue(value, fee, coinsPerUtxoWord) {

        let outputValue = undefined;
        let adaAmount = undefined;
        let tokenObjAry = new Array();
        let assetPids = new Array();
        let assetNames = new Array();
        let numAssets = 0;
        let sumAssetNameLengths = 0;

        // to caculate the numAssets & numPids & sumAssetNameLengths
        for (let index = 0; index < value.length; index++) {
            let itemAmount = value[index];

            if ("lovelace" === itemAmount.unit) {
                adaAmount = itemAmount.amount;

            } else {
                tokenObjAry.push(itemAmount);

                let matchedIndex = assetPids.indexOf(itemAmount.unit);
                if (-1 === matchedIndex) {
                    assetPids.push(itemAmount.unit);
                }

                matchedIndex = assetNames.indexOf(itemAmount.name);
                if (-1 === matchedIndex) {
                    assetNames.push(itemAmount.name);

                    let asciiName = this.hexStr2Ascii(itemAmount.name);
                    sumAssetNameLengths += asciiName.length;
                }

                numAssets++;
            }
        }

        if (0 < numAssets) {
            // in case of token assets
            let multiAssetInfo = {
                "numAssets": numAssets,
                "numPids": assetPids.length,
                "sumAssetNameLengths": sumAssetNameLengths
            }
            // console.log("\n\n...multiAssetInfo...: ", multiAssetInfo);

            let boundAdaAmount = adaAmount;
            if (undefined === boundAdaAmount) {
                boundAdaAmount = "1000000"; //this.caculateMinAdaValue(multiAssetInfo, coinsPerUtxoWord); // 
            }
            // console.log("\n\n...boundAdaAmount...: ", boundAdaAmount, tokenObjAry);
            outputValue = this.buildMultiAsset(tokenObjAry, boundAdaAmount); //"1444443"

        } else if (undefined !== adaAmount) {
            // in case of pure ada
            // to caculate the transfer value by sub agentFee based on amount
            let amount = CardanoWasm.BigNum.from_str(this.number2String(adaAmount));

            if (undefined !== fee) {
                let agentFee = CardanoWasm.BigNum.from_str(this.number2String(fee));
                let value = amount.checked_sub(agentFee);
                outputValue = CardanoWasm.Value.new(value);
            } else {
                outputValue = CardanoWasm.Value.new(amount);
            }

        } else {
            // in invalid condition
            return undefined;
        }

        return outputValue;
    }

    decodeUtxo(encodedUtxo) {
        let utxoInfoObj = {
            "txIn": undefined,
            "txOut": undefined
        };

        // Step 1: to restore the txIn data from encodedUtxo
        let txIn = encodedUtxo.input();
        let txInData = {
            "txId": this.byteArray2Hexstring(txIn.transaction_id().to_bytes()),
            "index": txIn.index()
        }
        utxoInfoObj.txIn = txInData;

        // Step 2: to restore the txOut data from encodedUtxo
        let txOut = encodedUtxo.output();
        let outValue = txOut.amount();

        // part 1: to parse ada asset
        let outAmountAry = new Array();
        let assetItem = {
            "unit": "lovelace",
            "quantity": outValue.coin().to_str()
        }
        outAmountAry.push(assetItem);

        // part 2: to parse multi asset in case
        if (undefined !== outValue.multiasset()) {

            let scriptHashs = outValue.multiasset().keys();
            for (let k = 0; k < scriptHashs.len(); k++) {
                let scriptHash = scriptHashs.get(k);
                let strPolicyId = this.byteArray2Hexstring(scriptHash.to_bytes());

                let assetInfo = outValue.multiasset().get(scriptHash);
                let assetNames = assetInfo.keys();
                for (let m = 0; m < assetNames.len(); m++) {
                    let assetName = assetNames.get(m);
                    let strName = this.byteArray2Hexstring(assetName.name());
                    let strUnit = strPolicyId + "." + strName;

                    let assetAmount = assetInfo.get(assetName);

                    let assetItem = {
                        "unit": strUnit,
                        "quantity": assetAmount.to_str()
                    }
                    outAmountAry.push(assetItem);
                }
            }
        }

        let txOutData = {
            "address": txOut.address().to_bech32(this.ADDR_PREFIX),
            "value": outAmountAry
        }
        utxoInfoObj.txOut = txOutData;

        return utxoInfoObj;
    }

    getUtxoByUtxoId(utxos, utxoId) {

        for (let i = 0; i < utxos.length; i++) {
            let utxoItem = utxos[i];
            console.log("\n..getUtxoByUtxoId item: ", utxoItem);
            let txIn = {
                "txId": utxoItem.txHash,
                "index": utxoItem.index
            }

            // format utxo value
            let formatValue = new Array();
            let valueItem = {
                "unit": "lovelace",
                "quantity": utxoItem.value.coins
            }
            formatValue.push(valueItem);
            for (let key in utxoItem.value.assets) {
                let assetUnit = key.replace(".", "");
                let assetItem = {
                    "unit": assetUnit,
                    "quantity": utxoItem.value.assets[key]
                }
                formatValue.push(assetItem);
            }

            let txOut = {
                "address": utxoItem.address,
                "value": formatValue
            }
            let formatUtxo = {
                "txIn": txIn,
                "txOut": txOut
            }

            let encUtxo = this.encodeUtxo(formatUtxo);
            let tmpUtxoId = encUtxo.input().to_hex();
            if (tmpUtxoId === utxoId) {
                return utxoItem;
            }
        }

        return undefined;
    }


    filterUtxosFromFormatedUtxos(utxos, formatedUtxos) {
        let filtedUtxos = new Array();

        for (let i = 0; i < formatedUtxos.length; i++) {
            let formatUtxoItem = formatedUtxos[i];
            let formatTxId = formatUtxoItem.txIn.txId;
            let formatTxIndex = formatUtxoItem.txIn.index;

            for (let j = 0; j < utxos.length; j++) {
                let utxoItem = utxos[j];

                if ((formatTxId === utxoItem.txHash)
                    && (formatTxIndex === utxoItem.index)) {
                    filtedUtxos.push(utxoItem);
                    break;
                }
            }
        }

        return filtedUtxos;
    }


    getFormatUtxoByUtxoId(formatUtxos, utxoId) {

        for (let i = 0; i < formatUtxos.length; i++) {
            let utxoItem = utxos[i];

            let encUtxo = this.encodeUtxo(utxoItem);
            let tmpUtxoId = encUtxo.input().to_hex();
            if (tmpUtxoId === utxoId) {
                return utxoItem;
            }
        }

        return undefined;
    }

    formatUtxoData(utxos) {
        let formatUtxos = new Array();

        for (let i = 0; i < utxos.length; i++) {
            let utxoItem = utxos[i];
            // console.log("\n..formatUtxoData item: ", utxoItem);
            let txIn = {
                "txId": utxoItem.txHash,
                "index": utxoItem.index
            }

            // format utxo value
            let formatValue = new Array();
            let valueItem = {
                "unit": "lovelace",
                "quantity": utxoItem.value.coins
            }
            formatValue.push(valueItem);
            for (let key in utxoItem.value.assets) {
                let assetUnit = key.replace(".", "");
                let assetItem = {
                    "unit": assetUnit,
                    "quantity": utxoItem.value.assets[key]
                }
                formatValue.push(assetItem);
            }

            let txOut = {
                "address": utxoItem.address,
                "value": formatValue
            }
            let formatUtxo = {
                "txIn": txIn,
                "txOut": txOut
            }
            formatUtxos.push(formatUtxo);
        }

        return formatUtxos;
    }

    genFormatedUtxo(txId, txIndex, toAddress, adaAmout, mapTokenAmount) {
        let txIn = {
            "txId": txId,
            "index": txIndex
        }

        // format utxo value
        let formatValue = new Array();
        let valueItem = {
            "unit": "lovelace",
            "quantity": adaAmout
        }
        formatValue.push(valueItem);

        for (let key in mapTokenAmount) {
            let assetUnit = key.replace(".", "");
            let assetItem = {
                "unit": assetUnit,
                "quantity": mapTokenAmount[key]
            }
            formatValue.push(assetItem);
        }

        let txOut = {
            "address": toAddress,
            "value": formatValue
        }
        let formatUtxo = {
            "txIn": txIn,
            "txOut": txOut
        }

        return formatUtxo;
    }

    initProtocolParams(protocolParams) {
        const linearFee = CardanoWasm.LinearFee.new(
            CardanoWasm.BigNum.from_str('' + protocolParams.minFeeCoefficient),//(protocolParams.linearFee.minFeeA),
            CardanoWasm.BigNum.from_str('' + protocolParams.minFeeConstant)//(protocolParams.linearFee.minFeeB)
        );

        const memPriceParams = protocolParams.prices.memory.split('/');
        const stepPriceParams = protocolParams.prices.steps.split('/');
        const exUnitPrice = CardanoWasm.ExUnitPrices.new(
            CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(memPriceParams[0]), CardanoWasm.BigNum.from_str(memPriceParams[1]))
            , CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str(stepPriceParams[0]), CardanoWasm.BigNum.from_str(stepPriceParams[1])))


        if (!protocolParams.coinsPerUtxoByte) {
            return CardanoWasm.TransactionBuilderConfigBuilder.new()
                .fee_algo(linearFee)
                .pool_deposit(CardanoWasm.BigNum.from_str(protocolParams.poolDeposit + ''))//('500000000'))
                .key_deposit(CardanoWasm.BigNum.from_str(protocolParams.stakeKeyDeposit + ''))//('2000000'))
                .max_value_size(+protocolParams.maxValueSize)//(4000)
                .max_tx_size(+protocolParams.maxTxSize)//(8000)
                .coins_per_utxo_word(CardanoWasm.BigNum.from_str(protocolParams.coinsPerUtxoWord + ''))
                .ex_unit_prices(exUnitPrice)
                .build();
        } else {
            return CardanoWasm.TransactionBuilderConfigBuilder.new()
                .fee_algo(linearFee)
                .pool_deposit(CardanoWasm.BigNum.from_str(protocolParams.poolDeposit + ''))//('500000000'))
                .key_deposit(CardanoWasm.BigNum.from_str(protocolParams.stakeKeyDeposit + ''))//('2000000'))
                .max_value_size(+protocolParams.maxValueSize)//(4000)
                .max_tx_size(+protocolParams.maxTxSize)//(8000)
                .coins_per_utxo_byte(CardanoWasm.BigNum.from_str(protocolParams.coinsPerUtxoByte + ''))
                .ex_unit_prices(exUnitPrice)
                .build();
        }
    }

    initTxBuilder(protocolParams) {
        const txBuilderCfg = this.initProtocolParams(protocolParams);
        return CardanoWasm.TransactionBuilder.new(txBuilderCfg);
    }

    funValue(valueMap) {
        const mutiAsset = CardanoWasm.MultiAsset.new();
        const assets = CardanoWasm.Assets.new();

        for (const assetId in valueMap.assets) {
            const assetValue = valueMap.assets[assetId];
            let [policy_id, assetName] = assetId.split('.');
            if (!assetName) assetName = '';
            assets.insert(CardanoWasm.AssetName.new(Buffer.from(assetName, 'hex')), CardanoWasm.BigNum.from_str('' + assetValue));
            mutiAsset.insert(CardanoWasm.ScriptHash.from_hex(policy_id), assets);
        }

        let value = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str('' + valueMap.coins));
        value.set_multiasset(mutiAsset);

        return value;
    }

    retrieveUtxoAssetType(formatUtxo) {
        let mapAssetType = new Map();
        let outputs = formatUtxo.txOut;
        for (let j = 0; j < outputs.value.length; j++) {
            let itemAsset = outputs.value[j];
            mapAssetType.set(itemAsset.unit, true);
        }

        return mapAssetType;
    }

    filterUtxosByAssetUnit(formatUtxos, assetUnit, bNFT = false) {

        let assetMatchedUtxos = new Array();
        for (let k = 0; k < formatUtxos.length; k++) {
            let mapAssetType = new Map();
            let outputs = formatUtxos[k].txOut;
            for (let j = 0; j < outputs.value.length; j++) {
                let itemAsset = outputs.value[j];
                mapAssetType.set(itemAsset.unit, true);
                // console.log("\n\n...filterUtxosByAssetUnit: ", k, itemAsset);
            }

            // to filter multi-asset utxos
            // console.log("..PlutusTxBuilder......mapAssetType size :", mapAssetType, assetUnit);
            if ((2 >= mapAssetType.size) || bNFT) {
                if (!assetUnit) {
                    assetMatchedUtxos.push(formatUtxos[k]);

                } else if (("lovelace" === assetUnit) && (1 === mapAssetType.size)) {
                    assetMatchedUtxos.push(formatUtxos[k]);

                } else if (("lovelace" !== assetUnit) && (mapAssetType.get(assetUnit.replace(".", "")))) {
                    assetMatchedUtxos.push(formatUtxos[k]);
                }
            }
        }

        return assetMatchedUtxos;
    }

    fetchAssetQualityInUtxo(formatUtxo, assetUnit) {
        if (undefined === formatUtxo) {
            return undefined;
        }

        let outputs = formatUtxo.txOut;
        for (let j = 0; j < outputs.value.length; j++) {
            let itemAsset = outputs.value[j];

            if (assetUnit === itemAsset.unit) {
                return itemAsset.quantity;
            }
        }
    }


    caculateTargetNftAmount(transferNftAmount, marginNftAmount) {
        let targetAmount = new Array();
        // console.log("\n...caculateTargetNftAmount...transferNftAmount: ", transferNftAmount);
        // console.log("\n...caculateTargetNftAmount...marginNftAmount: ", marginNftAmount);

        for (let i = 0; i < transferNftAmount.length; i++) {
            let nftAmountItem = transferNftAmount[i];
            // console.log("\n...caculateTargetNftAmount...transferNftAmount: ", nftAmountItem);
            let bnTargetAmount = CardanoWasm.BigNum.from_str(nftAmountItem.amount);
            let nftUnit = nftAmountItem.unit;
            let nftName = nftAmountItem.name;

            let bMatched = false;
            for (let j = 0; j < marginNftAmount.length; j++) {
                let amountItem = marginNftAmount[j];
                // console.log("\n...caculateTargetNftAmount...amountItem: ", amountItem);
                let bnItemAmount = CardanoWasm.BigNum.from_str(amountItem.amount);
                let itemUnit = amountItem.unit;
                let itemName = amountItem.name;

                if ((nftUnit === itemUnit) && (nftName === itemName)) {
                    bMatched = true;
                    if (bnTargetAmount.compare(bnItemAmount) > 0) {

                        let itemTargetInfo = {
                            "unit": nftUnit,
                            "name": nftName,
                            "amount": bnTargetAmount.checked_sub(bnItemAmount).to_str()
                        }
                        targetAmount.push(itemTargetInfo);
                    }
                    break;
                }
            }

            if (!bMatched) {
                targetAmount.push(nftAmountItem);
            }
        }

        return targetAmount;
    }

    caculateMarginNftAmount(transferNftAmount, reservedAmount) {
        let marginTransferAmount = new Array();

        for (let i = 0; i < transferNftAmount.length; i++) {
            let nftAmountItem = transferNftAmount[i];
            let bnTargetAmount = CardanoWasm.BigNum.from_str(nftAmountItem.amount);
            let nftUnit = nftAmountItem.unit;
            let nftName = nftAmountItem.name;

            let nftUniqueId = nftUnit + nftName; // the nft unique id should with no '.' 
            // console.log("..caculateMarginNftAmount..nftUniqueId: ", nftUniqueId);
            // nftInfos: map(unit -> amount)
            let strReservedAmount = reservedAmount.nftInfos[nftUniqueId];
            if (undefined === strReservedAmount) {
                strReservedAmount = "0";
            }

            let bnReservedAmount = CardanoWasm.BigNum.from_str(strReservedAmount);
            if (bnTargetAmount.compare(bnReservedAmount) > 0) {
                let marginAmount = {
                    "unit": nftUnit,
                    "name": nftName,
                    "amount": bnTargetAmount.checked_sub(bnReservedAmount).to_str()
                }
                marginTransferAmount.push(marginAmount);
            }
        }

        return marginTransferAmount;
    }

    caculateTotalAmountByAssetUnit(formatUtxos, assetUnit) {

        let formatAssetUnit = assetUnit.replace(".", "");
        let totalAmount = CardanoWasm.BigNum.from_str("0");

        for (let k = 0; k < formatUtxos.length; k++) {
            console.log("\n\n...caculateTotalAmountByAssetUnit: ", formatAssetUnit, formatUtxos[k]);
            let outputs = formatUtxos[k].txOut;
            for (let j = 0; j < outputs.value.length; j++) {
                let itemAsset = outputs.value[j];

                if (formatAssetUnit === itemAsset.unit) {
                    // bMatch = true;
                    // break;
                    let bnItemAmount = CardanoWasm.BigNum.from_str(itemAsset.quantity);
                    console.log("...caculateTotalAmountByAssetUnit  bnItemAmount: ", itemAsset.quantity);
                    totalAmount = totalAmount.checked_add(bnItemAmount);
                }
            }

            console.log("\n\n...caculateTotalAmountByAssetUnit  totalAmount: ", totalAmount.to_str());
        }

        return totalAmount;
    }

    caculateMaxFee(protocolParameters) {
        let iMinFeeA = BigInt(protocolParameters.minFeeCoefficient);
        let iMaxSize = BigInt(protocolParameters.maxTxSize);
        let iMinFeeB = BigInt(protocolParameters.minFeeConstant);

        let maxFee = iMinFeeA * iMaxSize + iMinFeeB;
        maxFee = CardanoWasm.BigNum.from_str(maxFee.toString());

        return maxFee;
    }

    sleep(time) {
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                resolve();
            }, time);
        })
    }

    slotToTimestamp(slot, eraSummaries, genisis) {

        let earIndexNumber = undefined;
        for (let i = 0; i < eraSummaries.length; i++) {
            const ear = eraSummaries[i];
            if ((slot >= ear.start.slot) && (slot <= ear.end.slot)) {
                earIndexNumber = i;
                break;
            } else if (slot > ear.end.slot) {
                continue;
            } else if (slot < ear.end.slot) {
                throw `Bad slot ${slot}`;
            }
        }

        if (undefined === earIndexNumber) {
            throw `Bad slot ${slot}`;
        }

        let sysStartTimeStamp = Date.parse(genisis.systemStart);
        const targetEar = eraSummaries[earIndexNumber];
        return sysStartTimeStamp + targetEar.start.time * 1000 + (slot - targetEar.start.slot) * targetEar.parameters.slotLength * 1000;
    }

    caculateInputValue(targetUtxos) {
        let inputAdaValue = CardanoWasm.BigNum.from_str('0');
        let mapInputTokenValue = new Map();

        for (let i = 0; i < targetUtxos.length; i++) {
            // console.log("\n\n...caculateInputValue: ", targetUtxos[i], targetUtxos[i].txIn, targetUtxos[i].txOut);
            let itemValue = targetUtxos[i].txOut.value;

            for (let j = 0; j < itemValue.length; j++) {
                // console.log("\n...caculateInputValue: ", itemValue[j].unit, itemValue[j].quantity);
                if ("lovelace" === itemValue[j].unit) {
                    let bnAssetAmount = CardanoWasm.BigNum.from_str(itemValue[j].quantity);
                    inputAdaValue = inputAdaValue.checked_add(bnAssetAmount);

                } else {
                    let tmpAmount = CardanoWasm.BigNum.from_str(itemValue[j].quantity);
                    let bnAssetValue = mapInputTokenValue.get(itemValue[j].unit);
                    if (undefined === bnAssetValue) {
                        bnAssetValue = CardanoWasm.BigNum.from_str('0');
                    }

                    bnAssetValue = bnAssetValue.checked_add(tmpAmount);
                    mapInputTokenValue.set(itemValue[j].unit, bnAssetValue); // unit has no '.' charactor
                }
            }
        }

        let inputValue = {
            "coin": inputAdaValue,
            "asset": mapInputTokenValue
        };
        // console.log("\n...caculateInputValue ret: ", inputValue);
        return inputValue;
    }

    compareUtxoAssetValue(assetUnit) {

        return function (utxoItemA, utxoItemB) {

            if ((undefined === utxoItemA) || (undefined === utxoItemB)
                || (undefined === utxoItemA.txOut) || (undefined === utxoItemB.txOut)
                || (undefined === utxoItemA.txOut.value) || (undefined === utxoItemB.txOut.value)) {
                return undefined;
            }

            let itemAssetValueA = CardanoWasm.BigNum.from_str("0");
            for (let v = 0; v < utxoItemA.txOut.value.length; v++) {
                let valueItem = utxoItemA.txOut.value[v];
                if (assetUnit === valueItem.unit) {
                    let tmpAmount = CardanoWasm.BigNum.from_str(this.number2String(valueItem.quantity));
                    itemAssetValueA = itemAssetValueA.checked_add(tmpAmount);
                }
            }

            let itemAssetValueB = CardanoWasm.BigNum.from_str("0");;
            for (let v = 0; v < utxoItemB.txOut.value.length; v++) {
                let valueItem = utxoItemB.txOut.value[v];
                if (assetUnit === valueItem.unit) {
                    let tmpAmount = CardanoWasm.BigNum.from_str(this.number2String(valueItem.quantity));
                    itemAssetValueB = itemAssetValueB.checked_add(tmpAmount);
                }
            }

            let ret = itemAssetValueA.compare(itemAssetValueB);
            return ret;
        }
    }

    compareByProperty(prop) {
        return function (obj1, obj2) {
            let val1 = obj1[prop];
            let val2 = obj2[prop];

            if (val1 < val2) {
                return 1;
            } else if (val1 > val2) {
                return -1;
            } else {
                return 0;
            }
        }
    }

    uniqueUtxosInArray(targetUtxos, newUtxos) {
        if (undefined === targetUtxos) {
            targetUtxos = new Array();
        }

        for (let m = 0; m < newUtxos.length; m++) {
            let tmpUtxo = newUtxos[m];
            let tmpTxId = tmpUtxo.txIn.txId;
            let tmpTxIndex = tmpUtxo.txIn.index;

            let bExist = false;
            for (let n = 0; n < targetUtxos.length; n++) {
                let txId = targetUtxos[n].txIn.txId;
                let txIndex = targetUtxos[n].txIn.index;
                if ((tmpTxId === txId) && (tmpTxIndex === txIndex)) {
                    bExist = true;
                    break;
                }
            }

            if (!bExist) {
                targetUtxos.push(tmpUtxo);
            }
        }

        return targetUtxos;
    }

    parseTreasuryUtxoChangeData(balancedParseRet, transferAmount, tokenAmount, protocolParams, paymentAddress, userData = undefined) {

        let datum = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        if (undefined !== userData) {
            datum = CardanoWasm.PlutusData.from_hex(userData);
        }

        let bnOutputNum = CardanoWasm.BigNum.from_str(this.number2String(balancedParseRet.outputNum));
        let formatUtxos = this.formatUtxoData(balancedParseRet.coordinateUtxos);

        let totalInputAmount = this.caculateInputValue(formatUtxos);
        let bnInputCoinValue = totalInputAmount.coin;

        let adaAmount = CardanoWasm.BigNum.from_str('0');
        let marginAda = CardanoWasm.BigNum.from_str('0');

        if ("lovelace" === transferAmount.unit) {
            console.log("\n..parseTreasuryUtxoChangeData transfer ada: ", transferAmount);
            const minAda = this.getMinAdaOfUtxo(protocolParams,
                paymentAddress,
                { coins: transferAmount.amount, assets: {} },
                datum);
            let bnMinAda = CardanoWasm.BigNum.from_str(this.number2String(minAda));
            const bnTransferValue = CardanoWasm.BigNum.from_str(this.number2String(transferAmount.amount));
            console.log("\n..parseTreasuryUtxoChangeData bnMinAda: ", bnMinAda.to_str(), bnTransferValue.to_str(), bnInputCoinValue.to_str());

            if (0 === bnInputCoinValue.compare(bnTransferValue)) {
                console.log("\n..parseTreasuryUtxoChangeData bnInputCoinValue is equle with bnTransferValue: ", bnTransferValue.to_str());
                bnOutputNum = CardanoWasm.BigNum.from_str('0');
                adaAmount = bnTransferValue;

            } else if (1 === bnInputCoinValue.compare(bnTransferValue)) {
                console.log("\n..parseTreasuryUtxoChangeData bnInputCoinValue is large than bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                let unitOutputAda = bnInputCoinValue.checked_sub(bnTransferValue).div_floor(bnOutputNum);
                console.log("\n..parseTreasuryUtxoChangeData unitOutputAda: ", bnOutputNum.to_str(), unitOutputAda.to_str());

                // if not enough for split, then not to balanced 
                if (-1 === unitOutputAda.compare(bnMinAda)) {
                    console.log("\n..parseTreasuryUtxoChangeData unitOutputAda is smaller than minAda: ", unitOutputAda.to_str(), bnMinAda.to_str());
                    marginAda = bnMinAda.checked_sub(unitOutputAda).checked_mul(bnOutputNum);
                    console.log("\n..parseTreasuryUtxoChangeData marginAda: ", marginAda.to_str());
                }
                adaAmount = bnTransferValue;

            } else {
                console.log("\n..parseTreasuryUtxoChangeData bnInputCoinValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                console.log("..parseTreasuryUtxoChangeData bnInputCoinValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                return undefined;
            }
            console.log("\n..parseTreasuryUtxoChangeData transfer ada: ", marginAda.to_str(), adaAmount.to_str(), bnOutputNum.to_str());

        } else {
            const tokenUnit = transferAmount.unit + "." + transferAmount.name;
            const minBindAda = this.getMinAdaOfUtxo(protocolParams, paymentAddress, { coins: 0, assets: { [tokenUnit]: transferAmount.amount } }, datum);
            const bnMinBindAda = CardanoWasm.BigNum.from_str(this.number2String(minBindAda));
            const bnInputAssetValue = totalInputAmount.asset.get(tokenUnit.replace(".", ""));
            const bnTransferValue = CardanoWasm.BigNum.from_str(this.number2String(tokenAmount));

            if (0 === bnInputAssetValue.compare(bnTransferValue)) {
                bnOutputNum = CardanoWasm.BigNum.from_str('0');

                if (0 === bnInputCoinValue.compare(bnMinBindAda)) {
                    // bnOutputNum = CardanoWasm.BigNum.from_str('0');
                    adaAmount = bnMinBindAda;

                } else {
                    const minAda = this.getMinAdaOfUtxo(protocolParams,
                        paymentAddress,
                        { coins: "10000000", assets: {} },
                        datum);
                    let bnMinAda = CardanoWasm.BigNum.from_str(this.number2String(minAda));

                    let changeAda = bnInputCoinValue.checked_sub(bnMinBindAda);
                    if (-1 === changeAda.compare(bnMinAda)) {
                        // in this case, changeAda should be filled in bindAda
                        adaAmount = bnInputCoinValue;
                    } else {
                        adaAmount = bnMinBindAda;
                    }
                }

            } else if (1 === bnInputAssetValue.compare(bnTransferValue)) {

                let changeBindAda = bnInputCoinValue.checked_sub(bnMinBindAda).div_floor(bnOutputNum);
                if (changeBindAda.less_than(bnMinBindAda)) {
                    marginAda = bnMinBindAda.checked_sub(changeBindAda).checked_mul(bnOutputNum);
                }

                adaAmount = bnMinBindAda;
            } else {
                console.log("\n..parseTreasuryUtxoChangeData bnInputAssetValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                console.log("..parseTreasuryUtxoChangeData bnInputAssetValue is not enough for bnTransferValue: ", bnTransferValue.to_str(), bnInputCoinValue.to_str());
                return undefined;
            }

            console.log("\n..parseTreasuryUtxoChangeData transfer token: ", marginAda.to_str(), adaAmount.to_str(), bnOutputNum.to_str());
        }

        // TODO: need to parse minAda in case of token transfer
        let treasuryUtxoChangeInfo = {
            "marginAda": marginAda,
            "adaAmount": adaAmount.to_str(),
            "outputNum": parseInt(bnOutputNum.to_str())
        }
        console.log("\n..parseTreasuryUtxoChangeData result: ", treasuryUtxoChangeInfo);
        return treasuryUtxoChangeInfo;
    }

    parseTreasuryNftUtxoChangeData(protocolParams, formatTargetUtxos, transferNftAmount, paymentAddress) {
        // step 1: caculate input amount
        // let formatUtxos = this.formatUtxoData(targetUtxos);
        // totalInputAmount = {
        //     "coin": inputAdaValue,
        //     "asset": mapInputTokenValue // unit -> bnAssetValue
        // };`
        let totalInputAmount = this.caculateInputValue(formatTargetUtxos);
        if (CardanoWasm.BigNum.from_str('0') === totalInputAmount.coin) {
            return undefined;
        }
        let bnInputCoinValue = totalInputAmount.coin;
        let mapInputTokenValue = totalInputAmount.asset;

        let mapChangedAmount = new Map();
        let mapMergedAmount = new Map();
        let mergedAssetsObj = {};
        let changedAssetsObj = {};

        for (let [key, bnInputAssetValue] of mapInputTokenValue) {
            let assetUnit = key.replace(".", "");
            console.log("\n\n..parseTreasuryNftUtxoChangeData..assetUnit: ", key, assetUnit);
            let bMatched = false;
            for (let i = 0; i < transferNftAmount.length; i++) {
                let tokenUnit = transferNftAmount[i].unit + transferNftAmount[i].name;
                if (assetUnit !== tokenUnit) {
                    continue;
                }

                let strTargetValue = transferNftAmount[i].amount;
                let bnTargetValue = CardanoWasm.BigNum.from_str(strTargetValue);
                let ret = bnInputAssetValue.compare(bnTargetValue);
                if (0 < ret) {
                    // in case need to change, record change info
                    let bnChangeAmount = bnInputAssetValue.checked_sub(bnTargetValue);
                    mapChangedAmount.set(assetUnit, bnChangeAmount);
                    changedAssetsObj[assetUnit] = bnChangeAmount.to_str();

                    // and also record merge info
                    mapMergedAmount.set(assetUnit, bnTargetValue);
                    mergedAssetsObj[assetUnit] = bnTargetValue.to_str();

                } else {
                    // in case no need to change, just record merge info
                    mapMergedAmount.set(assetUnit, bnInputAssetValue);
                    mergedAssetsObj[assetUnit] = bnInputAssetValue.to_str();
                }

                bMatched = true;
                break;
            }

            if (!bMatched) {
                // in case there is non-related asset, then need to record change info
                mapChangedAmount.set(key, bnInputAssetValue);
                changedAssetsObj[key] = bnInputAssetValue.to_str();
            }
        }

        // step 2: to caculate min ada for changed output utxo
        // let datum = CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0'));
        const mPlutusList = CardanoWasm.PlutusList.new();
        mPlutusList.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('1')));

        let datum = CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                mPlutusList
            ));

        let outputNum = 0; // default output num

        let bnMinBindAda4Change = CardanoWasm.BigNum.from_str('0');
        if (0 < mapChangedAmount.size) {
            let minBindAda = this.getMinAdaOfUtxo(protocolParams,
                paymentAddress,
                { coins: 0, assets: changedAssetsObj },
                datum);

            bnMinBindAda4Change = CardanoWasm.BigNum.from_str(this.number2String(minBindAda));
            outputNum++;
        }

        let bnMinBindAda4Merge = CardanoWasm.BigNum.from_str('0');
        if (0 < mapMergedAmount.size) {
            let minBindAda = this.getMinAdaOfUtxo(protocolParams,
                paymentAddress,
                { coins: 0, assets: mergedAssetsObj },
                datum);

            bnMinBindAda4Merge = CardanoWasm.BigNum.from_str(this.number2String(minBindAda));
            outputNum++;
        }

        let bnChangedBindAda = CardanoWasm.BigNum.from_str('0');
        let bnMarginAda = CardanoWasm.BigNum.from_str('0');
        let bnMinAda = bnMinBindAda4Change.checked_add(bnMinBindAda4Merge);
        if (0 > bnInputCoinValue.compare(bnMinAda)) {
            bnMarginAda = bnMinAda.checked_sub(bnInputCoinValue);
            bnChangedBindAda = bnMinBindAda4Change;
        } else {
            bnChangedBindAda = bnInputCoinValue.checked_sub(bnMinBindAda4Merge);
        }

        let ret = {
            "outputNum": outputNum,
            "adaAmount": bnInputCoinValue,
            "marginAda": bnMarginAda,
            "mergedAmount": mergedAssetsObj,
            "mergedBindAda": bnMinBindAda4Merge,
            "changedAmount": mapChangedAmount,
            "changedBindAda": bnChangedBindAda
        }
        console.log("\n\n..parseTreasuryNftUtxoChangeData..ret : ", JSON.stringify(ret));

        return ret;
    }

    // to check the balanced utxos condition by address and tokenId
    getPendingBalancedUtxosByUnit(originUtxos, assetUnit) {
        // to filter utxos by assetUnit
        let assetUtxos = this.filterUtxosByAssetUnit(originUtxos, assetUnit);
        if (0 === assetUtxos.length) {
            return undefined;
        }

        let balancedOption = {
            "assetUnit": assetUnit,
            "assetUtxos": assetUtxos
        };
        return balancedOption;
    }

    genAssetMaskByAmount(amounts) {
        let assetMask = new Map();
        for (let i = 0; i < amounts.length; i++) {
            let policyId = amounts[i].unit;
            let name = amounts[i].name;
            let value = amounts[i].amount;

            let type = policyId + name;
            assetMask.set(type, value);
        }

        return assetMask;
    }

    metadata2datum(metadata, version = 0, extra = '') {
        const ls = CardanoWasm.PlutusList.new();

        const metadataMap = CardanoWasm.PlutusMap.new();
        for (const key in metadata) {
            const keydata = Buffer.from(key, 'utf8');
            const vdataType = typeof metadata[key];
            let vdata;
            switch (vdataType) {
                case 'string':
                    vdata = CardanoWasm.PlutusData.new_bytes(Buffer.from(metadata[key], 'ascii'));
                    break;
                case 'bigint':
                case 'boolean':
                case 'number':
                    vdata = CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('' + metadata[key]));
                    break;
                default:
                    throw 'wrong metadata element type: [key]' + key
                    break;
            }

            const tmp = CardanoWasm.PlutusMapValues.new();
            tmp.add(vdata);
            metadataMap.insert(CardanoWasm.PlutusData.new_bytes(keydata), tmp);
        }

        ls.add(CardanoWasm.PlutusData.new_map(metadataMap));
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str(version + '')));
        if (extra) {
            ls.add(CardanoWasm.PlutusData.from_hex(extra));
        } else {
            ls.add(CardanoWasm.PlutusData.new_empty_constr_plutus_data(CardanoWasm.BigNum.from_str('0')));//from_hex(extra));
        }

        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                ls
            )
        ).to_hex();
    }    

    genDemoDatum42() {
        return CardanoWasm.PlutusData.new_constr_plutus_data(
            CardanoWasm.ConstrPlutusData.new(
                CardanoWasm.BigNum.from_str('0'),
                this.datum42()
            )
        )
    }

    datum42() {
        const ls = CardanoWasm.PlutusList.new();
        ls.add(CardanoWasm.PlutusData.new_integer(CardanoWasm.BigInt.from_str('1')));
        return ls;
    }

}


module.exports = CommonUtil;

