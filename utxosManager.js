const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
if (CardanoWasm.__wasm.memory.buffer.byteLength < 6000000)
    CardanoWasm.__wasm.memory.grow(100);

const Common = require('./util/common');
const config = require('./config');
const UtxoSelectionService = require('./bizServices/utxoSelectionService');

class UtxosManager {

    constructor(chainConnector, logUtil, bMainnet) {
        this.connector = chainConnector;
        this.bMainnet = bMainnet;
        this.logger = logUtil;

        this.ADDR_PREFIX = config.PlutusCfg.testnetPrefix;
        this.network_id = CardanoWasm.NetworkInfo.testnet_preprod().network_id();
        if (bMainnet) {
            this.ADDR_PREFIX = config.PlutusCfg.mainnetPrefix;
            this.network_id = CardanoWasm.NetworkInfo.mainnet().network_id();
        }
        this.maxPlutusUtxoNum = config.PlutusCfg.maxUtxoNum;

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
        this.mapPendingConsumedUTXO = new Map();
        /* Modify By NFT Program: 
            add mapReservedNftUtxo to record nft utxo usage in memory 
        */
        this.mapReservedNftUtxo = new Map(); // utxoId -> {reservedTxId, reservedAmount(unit -> amount), reservedSlot}

        this.mapAddressAvailableUtxos = new Map();
        this.mapAccountLocker = new Map();

        // to new common util instance
        this.commonUtil = new Common(this.ADDR_PREFIX);
        this.utxoSelectionService = new UtxoSelectionService(this.ADDR_PREFIX);

    }

    async init() {

        return await this.getCurChainParams();
    }

    // set related address config
    setSmgLeaderAddress(smgLeaderAddr) {
        this.paymentAddress = smgLeaderAddr;
    }

    setTreasuryScAddress(treasuryScAddress) {
        this.treasuryScAddress = treasuryScAddress;
    }

    setNftTreasuryScAddress(nftTreasuryScAddress) {
        this.nftTreasuryScAddress = nftTreasuryScAddress;
    }

    // retrieve chain parameters
    async getCurChainParams() {
        let latestChainTip = undefined;
        try {
            latestChainTip = await this.connector.chainTip();
            // this.logger.debug("..UtxosManager......latestChainTip: ", latestChainTip);
        } catch (e) {
            this.logger.debug("..UtxosManager......failed to get chainTip: ", e);
            return false;
        }

        // step 2: to get lock 
        if ((undefined !== this.curChainTip)
            && ((this.curChainTip.slot + config.ChainStatusValidLatestSlot) > latestChainTip.slot)) {
            return true;
        }

        while (this.mapAccountLocker.get("latestChainStatusLocker")) {
            await this.commonUtil.sleep(1000);
        }

        this.mapAccountLocker.set("latestChainStatusLocker", true);

        if ((undefined === this.curChainTip)
            || ((this.curChainTip.slot + config.ChainStatusValidLatestSlot) <= latestChainTip.slot)) {
            try {
                // to filter utxos in security block scopes
                this.curLatestBlock = await this.connector.blocksLatest();
                // this.logger.debug("..UtxosManager......this.curLatestBlock: ", this.curLatestBlock);
            } catch (e) {
                this.logger.debug("..UtxosManager......get blocksLatest failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                let tmpProtocolParams = await this.connector.getCurrentProtocolParameters();
                // this.logger.debug("..UtxosManager......protocolParams: ", this.protocolParams);
                if ((undefined === tmpProtocolParams) || ("" === tmpProtocolParams)) {
                    this.logger.debug("..UtxosManager......getCurChainParams failed: ");
                    this.mapAccountLocker.set("latestChainStatusLocker", false);
                    return false;
                }

                this.protocolParams = tmpProtocolParams;
                this.minFeeA = JSON.stringify(this.protocolParams.minFeeCoefficient);
                this.minFeeB = JSON.stringify(this.protocolParams.minFeeConstant);
                this.coinsPerUtxoWord = JSON.stringify(this.protocolParams.coinsPerUtxoByte * 2);
                this.coinsPerUtxoByte = JSON.stringify(this.protocolParams.coinsPerUtxoByte);
                this.maxTxSize = JSON.stringify(this.protocolParams.maxTxSize);

            } catch (e) {
                this.logger.debug("..UtxosManager......getCurChainParams failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

            try {
                this.curChainTip = await this.connector.chainTip();
                this.logger.debug("..UtxosManager......get this.curChainTip onchain: ", this.curChainTip);

            } catch (e) {
                this.logger.debug("..UtxosManager......get chainTip failed: ", e);
                this.mapAccountLocker.set("latestChainStatusLocker", false);
                return false;
            }

        }

        this.mapAccountLocker.set("latestChainStatusLocker", false);
        return true;
    }


    async getUtxo(address, bCheckDatum = true, coinValue = 0) {
        const itemCount = 100;
        let pageNumber = 1;
        let utxos = new Array();
        let ret = new Array();
        let safeBlockNumber = 0;

        try {
            let rslt = await this.getCurChainParams();
            if (false === rslt) {
                this.logger.debug("..UtxosManager...getUtxo...getCurChainParams: ", rslt);
                return ret;
            }

        } catch (e) {
            this.logger.debug("..UtxosManager...getUtxo...getCurChainParams failed: ", e);
            return ret;
        }

        // to check if need to query from ogmios service
        let utxoRecordObj = this.mapAddressAvailableUtxos.get(address);
        if ((undefined !== utxoRecordObj)
            && (utxoRecordObj.recordSlot > (this.curChainTip.slot - config.UtxoValidLatestSlot))) {
            // pre-backup utxo is still valid
            //this.logger.debug("..UtxosManager......getUtxo...utxoRecordObj.utxos: ", utxoRecordObj.utxoRecords);
            return utxoRecordObj.utxoRecords;

        } else {
            // step 2: to check safe block height            
            while (this.mapAccountLocker.get(address)) {
                await this.commonUtil.sleep(1000);
            }
            this.mapAccountLocker.set(address, true);

            let curUtxoRecord = this.mapAddressAvailableUtxos.get(address);
            if (((undefined === utxoRecordObj) && (undefined !== curUtxoRecord))
                || ((undefined !== utxoRecordObj) && (utxoRecordObj.recordSlot !== curUtxoRecord.recordSlot))) {

                this.mapAccountLocker.set(address, false);
                return curUtxoRecord.utxoRecords;
            }

            // add exception catch for connector
            try {
                do {
                    let rslt = await this.connector.getAddressUTXOsWithBlockHeight(address, pageNumber, itemCount, 'asc');
                    // console.log(`..UtxosManager...getAddressUTXOsWithBlockHeight ${address}...${rslt.utxos}`);        
                    if (null == rslt) {
                        break;
                    } else {
                        utxos.push(...rslt.utxos);
                    }

                    if ("ogmios" === rslt.source) {
                        break;
                    } else if (itemCount > rslt.utxos.length) {
                        break;
                    } else {
                        pageNumber++;
                    }

                } while (true);

            } catch (e) {
                this.logger.debug("..UtxosManager......getUtxo...getAddressUTXOs failed: ", e);
                this.mapAccountLocker.set(address, false);
                return ret;
            }
        }
        // console.log(`..UtxosManager...getUtxo return ${utxos.length} utxo of ${address}`);
        // this.logger.debug(`..UtxosManager...getUtxo return ${utxos.length} utxo of ${address}`);

        // step 3: to filter safe utxos
        // 2023/06/27 modify: to filter safe utxos in wanOgmiosService api
        for (let i = 0; i < utxos.length; i++) {
            const utxo = utxos[i];
            let mapAsset = new Map();
            let coinsAmount = undefined;

            for (let j = 0; j < utxo.amount.length; j++) {
                if ("lovelace" === utxo.amount[j].unit) {
                    // if (coinValue && CardanoWasm.BigNum.from_str(utxo.amount[j].quantity + '').compare(
                    //     CardanoWasm.BigNum.from_str('' + coinValue)
                    // ) < 0) break;
                    let bnCoinAmount = mapAsset[utxo.amount[j].unit];
                    if (undefined === bnCoinAmount) {
                        bnCoinAmount = CardanoWasm.BigNum.from_str('0');
                    }
                    bnCoinAmount = bnCoinAmount.checked_add(CardanoWasm.BigNum.from_str(utxo.amount[j].quantity + ''));

                    coinsAmount = bnCoinAmount.to_str();

                } else {
                    // this.logger.debug("..UtxosManager......asset unit: ", utxo.amount[j].unit, utxo.amount[j].quantity + '')
                    let bnAssetAmount = mapAsset[utxo.amount[j].unit];
                    if (undefined === bnAssetAmount) {
                        bnAssetAmount = CardanoWasm.BigNum.from_str('0');
                    }
                    bnAssetAmount = bnAssetAmount.checked_add(CardanoWasm.BigNum.from_str(utxo.amount[j].quantity + ''));

                    // let assetUnit = utxo.amount[j].unit.replace(".", "");
                    let assetUnit = utxo.amount[j].unit;
                    mapAsset[assetUnit] = bnAssetAmount.to_str();
                }
            }

            // filter utxo with null datum
            let utxoDatum = this.connector.bUseOgmios ? utxo.data_hash : utxo.inline_datum;
            // console.log("utxoDatum: ", utxoDatum);
            // this.logger.debug("..UtxosManager......utxo utxoDatum: ", utxo.data_hash)
            if ((bCheckDatum && utxoDatum) || (!bCheckDatum)) {
                ret.push({
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
                });
            }
        }

        let newUtxoRecordObj = {
            "utxoRecords": ret,
            "recordSlot": this.curChainTip.slot
        }
        this.mapAddressAvailableUtxos.set(address, newUtxoRecordObj);
        this.mapAccountLocker.set(address, false);

        // this.logger.debug("..UtxosManager......ret len: ", ret.length);
        // console.log("..UtxosManager......ret len: ", ret);
        return ret;
    }


    checkPreReservedUtxo(utxos, txId, amount) {
        // Step 1: to check if there is preReserved utxo for this task
        // reservedInfo = {
        //     "utxoId": preReservedUtxoId,
        //     "nftInfos": reservedAmount, // {unit -> amount} , and unit with no '.'
        //     "priority": undefined
        // } 
        let reservedInfo = this.getPreReservedUtxoInfoByTxId(txId);
        if (undefined === reservedInfo) {
            // there is no reserved utxo for this task
            let ret = {
                "reservedUtxo": undefined,
                "reservedStatus": "NoReserved", // "noPreReserved"
                "marginAmount": amount
            }
            return ret;
        }

        // Step 2: to check whether the preReserved utxo is available 
        let preReservedUtxo = this.commonUtil.getUtxoByUtxoId(utxos, reservedInfo.utxoId);
        if (undefined === preReservedUtxo) {
            // the preReserved utxos is no available by now
            let ret = {
                "reservedUtxo": undefined,
                "reservedStatus": "PendingReserved",
                "marginAmount": undefined
            }
            return ret;
        }

        // Step 3: to check the amount of preReserved utxo whether has reached the transfer amount 
        let marginAmount = this.commonUtil.caculateMarginNftAmount(amount, reservedInfo);
        let ret = {
            // the preReserved utxo is available
            "reservedUtxo": preReservedUtxo,
            "reservedStatus": "ReservedAvailable",
            "marginAmount": marginAmount
        }

        // Step 4: to update preReservedutxoInfo
        this.updatePreReservedUtxoInfo();

        return ret;
    }

    async getTotalUtxos(fromAddress) {
        let pendingSelectionUtxos = new Array();

        // step 1: to get utxos of fromAddress
        let utxos = await this.getUtxo(fromAddress, (this.paymentAddress !== fromAddress));
        this.logger.debug("..getTotalUtxos...getUtxo utxos: ", this.paymentAddress, fromAddress, utxos.length);
        if (0 === utxos.length) {
            return pendingSelectionUtxos;
        }

        // step 2: to filter utxos in security block scopes
        for (let i = 0; i < utxos.length; i++) {
            if ((undefined !== utxos[i].blockHeight)
                && (utxos[i].blockHeight <= (this.curLatestBlock.height - config.SecurityBlocksForCoinSelection))) {
                pendingSelectionUtxos.push(utxos[i]);
            }
        }

        return pendingSelectionUtxos;
    }

    async getNftUtxoOfAmount(fromAddress, toAddress, amount, limit = undefined, uniqueId = undefined) {
        // to verify the amount validity
        if ((undefined === amount) || (0 === amount.length)) {
            this.logger.debug("..getNftUtxoOfAmount......invalid transfer amount: ", uniqueId, amount);
            return undefined;
        }

        // to get utxos of fromAddress
        let utxos = await this.getUtxo(fromAddress, (this.paymentAddress !== fromAddress));
        this.logger.debug("..getNftUtxoOfAmount......getUtxo utxos: ", this.paymentAddress, fromAddress, utxos.length);
        if (0 === utxos.length) {
            return undefined;
        }

        // to filter utxos in security block scopes
        let pendingSelectionUtxos = new Array();
        for (let i = 0; i < utxos.length; i++) {
            if ((undefined !== utxos[i].blockHeight)
                && (utxos[i].blockHeight <= (this.curLatestBlock.height - config.SecurityBlocksForCoinSelection))) {
                pendingSelectionUtxos.push(utxos[i]);
            }
        }

        /* Modify By NFT Program: 
            in NFT task case, need to check if this cctask has taken preReserved utxos
        */
        let selectedUtxos = new Array();
        let retCheck = this.checkPreReservedUtxo(pendingSelectionUtxos, uniqueId, amount);
        if ("PendingAvailable" === retCheck.reservedStatus) {
            // in case the preReserved utxo is not available yet
            let ret = {
                "totalUtxos": utxos,
                "selectedUtxos": undefined,
                "marginAmount": undefined,
                "checkStatus": "PendingAvailable"
            }
            return ret;

        } else if ("Available" === retCheck.reservedStatus) {
            // in case the reserved utxo is available
            selectedUtxos.push(retCheck.reservedUtxo);
            amount = retCheck.marginAmount;

            if (0 === retCheck.marginAmount.length) {
                // in case the reserved utxo satisfy the required amount 
                let ret = {
                    "totalUtxos": utxos,
                    "selectedUtxos": selectedUtxos,
                    "marginAmount": retCheck.marginAmount, // in this case, margin amount is empty array
                    "checkStatus": "Available"
                }
                return ret;
            }

        } else {
            // in case there is no preReserved utxo  
            this.logger.debug("there is no preReserved utxo for this ccTask: ", uniqueId);
        }

        // add asset type as filter params
        let availableUtxos = new Array();
        for (let m = 0; m < amount.length; m++) {
            let assetUnit = ("lovelace" === amount[m].unit) ? "lovelace" : (amount[m].unit + "." + amount[m].name);
            /* Modify By NFT Program: 
                checkAvailableUtxos need to do further to parse preReserved utxos
            */
            let availableUtxosByUnit = this.checkAvailableUtxos(fromAddress,
                pendingSelectionUtxos,
                false,
                assetUnit,
                true);
            if (undefined === availableUtxosByUnit) {
                continue;
            }
            /* Modify By NFT Program: 
                need to do further to unique utxo
            */
            availableUtxos = this.commonUtil.uniqueUtxosInArray(availableUtxos, availableUtxosByUnit);
        }
        if (0 === availableUtxos.length) {
            this.logger.debug("..UtxosManager......checkAvailableUtxos:  no available utxo");
            // in case no available utxos 
            let ret = {
                "totalUtxos": utxos,
                "selectedUtxos": selectedUtxos,
                "marginAmount": amount,
                "checkStatus": "NoAvailable"
            }
            return ret;
        }
        this.logger.debug("..UtxosManager......checkAvailableUtxos: ", availableUtxos.length);

        limit = (undefined === limit) ? limit : (limit - selectedUtxos.length);
        this.utxoSelectionService.setProtocolParameters(this.coinsPerUtxoByte, this.minFeeA, this.minFeeB, '10000');
        let filtedUtxo = this.utxoSelectionService.selectUtxos(availableUtxos, toAddress, amount, limit, true);
        if (0 === filtedUtxo.length) {
            // in case no any suitable utxo is selected
            let ret = {
                "totalUtxos": utxos,
                "selectedUtxos": selectedUtxos,
                "marginAmount": amount,
                "checkStatus": "InSufficent"
            }
            return ret;
        }

        // to update selected utxos status to pendingConsumed
        for (let j = 0; j < filtedUtxo.length; j++) {

            let utxoObj = filtedUtxo[j];
            let txId = utxoObj.txIn.txId;
            let txIndex = utxoObj.txIn.index;

            for (let k = 0; k < utxos.length; k++) {
                let utxo = utxos[k];
                if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                    selectedUtxos.push(utxo);

                    // to add new pending consumed utxos
                    let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(fromAddress);
                    let encUtxo = this.commonUtil.encodeUtxo(utxoObj);
                    let utxoId = encUtxo.input().to_hex();
                    mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                    this.mapPendingConsumedUTXO.set(fromAddress, mapConsumedUtxos);
                    break;
                }
            }
        }

        this.logger.debug("..UtxosManager......selectUtxos ret: ", selectedUtxos.length);
        let ret = {
            "totalUtxos": utxos,
            "selectedUtxos": selectedUtxos,
            "marginAmount": amount, // in this case, margin amount is empty array
            "checkStatus": "Available"
        }
        return ret;
    }

    async getUtxoOfAmount(fromAddress, toAddress, amount, limit) {
        // to verify the amount validity
        if ((undefined === amount) || (0 === amount.length)) {
            this.logger.debug("..getUtxoOfAmount......invalid transfer amount: ", amount);
            return undefined;
        }

        let assetUnit = ("lovelace" === amount[0].unit) ? "lovelace" : (amount[0].unit + amount[0].name);

        // to get utxos of fromAddress
        let utxos = await this.getUtxo(fromAddress, (this.paymentAddress !== fromAddress));
        this.logger.debug("..UtxosManager......getUtxo utxos: ", fromAddress, utxos.length);
        if (0 === utxos.length) {
            this.logger.debug("..getUtxoOfAmount......failed to get utxo:  ", fromAddress);
            return undefined;
        }

        // to filter utxos in security block scopes
        let pendingSelectionUtxos = new Array();
        for (let i = 0; i < utxos.length; i++) {
            if ((undefined !== utxos[i].blockHeight)
                && (utxos[i].blockHeight <= (this.curLatestBlock.height - config.SecurityBlocksForCoinSelection))) {
                pendingSelectionUtxos.push(utxos[i]);
            }
        }

        // add asset type as filter params
        let selectedUtxos = new Array();
        let availableUtxos = this.checkAvailableUtxos(fromAddress, pendingSelectionUtxos, false, assetUnit);
        if (undefined === availableUtxos) {
            this.logger.debug("..UtxosManager......checkAvailableUtxos:  no available utxo");
            let ret = {
                "totalUtxos": utxos,
                "selectedUtxos": selectedUtxos
            }
            return ret;
        }
        // this.logger.debug("..UtxosManager......checkAvailableUtxos: ", availableUtxos.length);

        this.utxoSelectionService.setProtocolParameters(this.coinsPerUtxoWord, this.minFeeA, this.minFeeB, '10000');
        let filtedUtxo = this.utxoSelectionService.selectUtxos(availableUtxos, toAddress, amount, limit);
        // to update selected utxos status to pendingConsumed
        for (let j = 0; j < filtedUtxo.length; j++) {

            let utxoObj = filtedUtxo[j];
            let txId = utxoObj.txIn.txId;
            let txIndex = utxoObj.txIn.index;

            for (let k = 0; k < utxos.length; k++) {
                let utxo = utxos[k];
                if ((txId === utxo.txHash) && (txIndex === utxo.index)) {
                    selectedUtxos.push(utxo);

                    // to add new pending consumed utxos
                    let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(fromAddress);
                    let encUtxo = this.commonUtil.encodeUtxo(utxoObj);
                    let utxoId = encUtxo.input().to_hex();
                    mapConsumedUtxos.set(utxoId, this.curChainTip.slot);
                    this.mapPendingConsumedUTXO.set(fromAddress, mapConsumedUtxos);
                    break;
                }
            }
        }

        this.logger.debug("..UtxosManager......selectUtxos ret: ", selectedUtxos.length);
        let ret = {
            "totalUtxos": utxos,
            "selectedUtxos": selectedUtxos
        }
        return ret;
    }

    checkAvailableUtxos(fromAddress, utxos, bCheckUtxoAddress, assetUnit = undefined, bNFT = false) {
        // Step1: to format utxos
        let formatUtxos = this.commonUtil.formatUtxoData(utxos);

        // Step2: to filter multi-asset utxos
        let availableUtxos = new Array();
        for (let k = 0; k < formatUtxos.length; k++) {
            let mapAssetUnit = new Map();
            let itemTxOut = formatUtxos[k].txOut;
            for (let v = 0; v < itemTxOut.value.length; v++) {
                let itemValue = itemTxOut.value[v];
                mapAssetUnit.set(itemValue.unit, true);
                // this.logger.debug("..UtxosManager......mapAssetUnit set :", itemValue.unit, assetUnit);
            }

            // to filter multi-asset utxos
            //this.logger.debug("..UtxosManager......mapAssetUnit size :", mapAssetUnit.size);
            if ((2 >= mapAssetUnit.size) || bNFT) {
                if (!assetUnit) {
                    availableUtxos.push(formatUtxos[k]);
                } else if (("lovelace" === assetUnit) && (1 === mapAssetUnit.size)) {
                    availableUtxos.push(formatUtxos[k]);
                } else if (("lovelace" !== assetUnit) && (mapAssetUnit.get(assetUnit.replace(".", "")))) {
                    availableUtxos.push(formatUtxos[k]);
                }
            }
        }
        // this.logger.debug("..UtxosManager......availableUtxos length:", fromAddress, assetUnit, availableUtxos.length);

        // Step3: to filter pending consumed utxo
        let filteredAvailableUtxos = undefined;
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(fromAddress);
        if (undefined === mapConsumedUtxos) {
            filteredAvailableUtxos = availableUtxos;
            mapConsumedUtxos = new Map();
            this.mapPendingConsumedUTXO.set(fromAddress, mapConsumedUtxos);

        } else {
            // Step3-1: to update pending consumed utxos 
            let maxPendingTTL = bCheckUtxoAddress ? config.MaxConsumedCheckUtxoTTL : config.MaxConsumedUtxoTTL;

            for (let key of mapConsumedUtxos.keys()) {
                let consumedInitialSlot = mapConsumedUtxos.get(key);
                let durSlot = this.curChainTip.slot - consumedInitialSlot;
                if (maxPendingTTL <= durSlot) {
                    mapConsumedUtxos.delete(key);
                }

                this.mapPendingConsumedUTXO.set(fromAddress, mapConsumedUtxos);
            }

            // Step3-2:  to filter pending consumed utxo
            for (let i = 0; i < availableUtxos.length; i++) {
                // this.logger.debug("..UtxosManager......filteredAvailableUtxos...available Utxo:", i, availableUtxos[i]);
                let encUtxo = this.commonUtil.encodeUtxo(availableUtxos[i]);
                let utxoId = encUtxo.input().to_hex();

                // to filter the pending consumed utxo
                let consumedInitialSlot = mapConsumedUtxos.get(utxoId);
                if (undefined !== consumedInitialSlot) {
                    // this.logger.debug("..UtxosManager......filteredAvailableUtxos...consumedInitialSlot:",availableUtxos[i], utxoId, consumedInitialSlot, this.curChainTip.slot);
                    continue;
                }

                /* Modify By NFT Program: 
                need also to filter the preReserved utxo                 
                */
                let reservedUtxoInfo = this.mapReservedNftUtxo.get(utxoId);
                if (undefined !== reservedUtxoInfo) {
                    // this.logger.debug("..plutusNftTxBuilder......filteredAvailableUtxos...consumedInitialSlot:",availableUtxos[i], utxoId, consumedInitialSlot, this.curChainTip.slot);
                    continue;
                }

                // confirm available utxos
                if (undefined === filteredAvailableUtxos) {
                    filteredAvailableUtxos = new Array();
                }
                filteredAvailableUtxos.push(availableUtxos[i]);
                // this.logger.debug("..UtxosManager......filteredAvailableUtxos...:", i, availableUtxos[i], utxoId);
            }
        }

        // this.logger.debug("..UtxosManager......filteredAvailableUtxos :", fromAddress);
        return filteredAvailableUtxos;
    }

    ///////////////////////////////////////////
    // Part 2: pending comsumed utxo management
    ///////////////////////////////////////////
    revertUtxoPendingComsumedStatus(inputUtxos) {

        for (let i = 0; i < inputUtxos.length; i++) {
            // to generate tx input based on txId&index
            let transaction_id = CardanoWasm.TransactionHash.from_bytes(Buffer.from(inputUtxos[i].txId, 'hex'));
            let txInput = CardanoWasm.TransactionInput.new(transaction_id, inputUtxos[i].index);

            // to generate utxoId by txInput
            let utxoId = txInput.to_hex();
            // this.logger.debug(`..UtxosManager..release utxo: ${inputUtxos[i].txId + '#' + inputUtxos[i].index} related to Key: ${utxoId}`);

            for (let address of this.mapPendingConsumedUTXO.keys()) {
                let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
                this.logger.debug("..UtxosManager...release origin mapConsumedUtxos: ", address, mapConsumedUtxos);
                if (mapConsumedUtxos.get(utxoId)) {
                    // this.logger.debug(`..UtxosManager..release utxoId: #${utxoId} in pendingUtxo of address: ${address}`);

                    mapConsumedUtxos.delete(utxoId);
                    this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
                    this.logger.debug("..UtxosManager...release updated mapConsumedUtxos: ", mapConsumedUtxos);
                    break;
                };
            }
        }
    }

    releaseUtxos(utxos) {
        let aryUtxos = undefined;
        if (utxos instanceof Array) {
            aryUtxos = utxos;
        } else {
            aryUtxos = [utxos];
        }

        let revertedUtxos = new Array();
        for (let i = 0; i < aryUtxos.length; i++) {
            this.logger.debug("..UtxosManager...release utxo: ", JSON.stringify(aryUtxos[i]));
            let utxoItem = {
                "txId": aryUtxos[i].txHash,
                "index": aryUtxos[i].index
            }
            revertedUtxos.push(utxoItem);
            // this.logger.debug(`..UtxosManager...release utxo: ${utxoItem.txId + '#' + utxoItem.index}`);
        }

        this.revertUtxoPendingComsumedStatus(revertedUtxos);
    }

    getPendingComsumedUtxoByAddress(address) {
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
        return mapConsumedUtxos;
    }

    appendPendingComsumedUtxo(address, utxo, curSlot) {
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
        if (undefined === mapConsumedUtxos) {
            mapConsumedUtxos = new Map();
        }
        let encUtxo = this.commonUtil.encodeUtxo(utxo);
        let utxoId = encUtxo.input().to_hex();
        mapConsumedUtxos.set(utxoId, curSlot);
        this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
    }

    deletePendingComsumedUtxoById(address, utxoId) {
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
        if (undefined === mapConsumedUtxos) {
            return;
        }

        mapConsumedUtxos.delete(utxoId);
        this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
        return;
    }

    updatePendingComsumedUtxoByAddress(address, curSlot, bCheckUtxoAddress) {
        let maxPendingTTL = bCheckUtxoAddress ? config.MaxConsumedCheckUtxoTTL : config.MaxConsumedUtxoTTL;

        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(address);
        if (undefined === mapConsumedUtxos) {
            // filteredAvailableUtxos = availableUtxos;
            mapConsumedUtxos = new Map();
            this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
        }

        for (let key of mapConsumedUtxos.keys()) {
            let consumedInitialSlot = mapConsumedUtxos.get(key);
            let durSlot = curSlot - consumedInitialSlot;
            if (maxPendingTTL <= durSlot) {
                mapConsumedUtxos.delete(key);
            }

            this.mapPendingConsumedUTXO.set(address, mapConsumedUtxos);
        }
    }


    parsePendingUtxoRatio(scAddress, availableUtxos) {
        let availableUtxosNum = availableUtxos.length;
        let mapConsumedUtxos = this.mapPendingConsumedUTXO.get(scAddress);
        if (undefined === mapConsumedUtxos) {
            mapConsumedUtxos = new Map();
        }

        let pendingUtxoNum = 0;
        for (let i = 0; i < availableUtxos.length; i++) {
            let utxoObj = availableUtxos[i];
            let encUtxo = this.commonUtil.encodeUtxo(utxoObj);
            let utxoId = encUtxo.input().to_hex();

            if (mapConsumedUtxos.get(utxoId)) {
                pendingUtxoNum++;
            }
        }

        let pendingUtxoRatio = parseFloat(pendingUtxoNum * 100 / availableUtxosNum);
        return pendingUtxoRatio;
    }

    ///////////////////////////////////////
    // Part 3: Pre-reserved utxo management
    ///////////////////////////////////////
    updatePreReservedUtxoInfo() {
        /* Modify By NFT Program: 
        and also need to filter pre-reserved utxos for nft balance                 
        */
        for (let utxoId of this.mapReservedNftUtxo.keys()) {
            let reservedUtxoInfo = this.mapReservedNftUtxo.get(utxoId);
            let durSlot = this.curChainTip.slot - reservedUtxoInfo.reservedSlot;
            if (config.MaxNftUtxoOccupiedTs < durSlot) {
                this.mapReservedNftUtxo.delete(utxoId);
            }
        }
    }

    deletePreReservedUtxoInfo(txId) {
        for (let [utxoId, reservedInfo] of this.mapReservedNftUtxo) {
            // let reservedInfo = this.mapReservedNftUtxo.get(utxoId);
            if (txId === reservedInfo.reservedTxId) {
                this.mapReservedNftUtxo.delete(utxoId);
            }
        }
    }

    getPreReservedUtxoInfoByTxId(txId) {

        // mapReservedNftUtxo:  utxoId -> {reservedTxId, reservedAmount, reservedSlot}
        for (let [utxoId, reservedInfo] of this.mapReservedNftUtxo) {
            // let reservedInfo = this.mapReservedNftUtxo.get(utxoId);
            if (txId === reservedInfo.reservedTxId) {
                let reservedUtxoInfo = {
                    "utxoId": utxoId,
                    "nftInfos": reservedInfo.reservedAmount,
                    "priority": undefined
                }
                return reservedUtxoInfo;
            }
        }

        return undefined;
    }

    getPreReservedInfoByUtxoId(utxoId, txId) {

        // mapReservedNftUtxo:  utxoId -> {reservedTxId, reservedAmount, reservedSlot}        
        let reservedInfo = this.mapReservedNftUtxo.get(utxoId);
        if (undefined === reservedInfo) {
            return undefined;
        }

        if (txId === reservedInfo.reservedTxId) {
            let reservedUtxoInfo = {
                "utxoId": utxoId,
                "nftInfos": reservedInfo.reservedAmount,
                "priority": undefined
            }
            return reservedUtxoInfo;
        }

        return undefined;
    }

    appendPreReservedUtxoInfo(utxoId, reservedInfo) {
        this.mapReservedNftUtxo.set(utxoId, reservedInfo);
    }


}


module.exports = UtxosManager;
