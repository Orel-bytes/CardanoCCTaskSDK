

const axios = require('axios');

class WanOgmiosApi {

    constructor(ogmiosHost, ogmiosPort) {
        this.ogmiosUrl = `${ogmiosHost}:${ogmiosPort}`;  
        console.log("\n\n ###### WanOgmiosApi... constructor ogmiosUrl: ", this.ogmiosUrl)     
    }

    //
    async currentProtocolParameters() {
        
        const data = {
        };

        let reqPath = '/getCostModelParameters';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('chainTip Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getCostModelParameters, e: ', err);
            return undefined;
        }
    }

    async chainTip() {
        
        const data = {
        };

        let reqPath = '/getChainTip';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('chainTip Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - chainTip, e: ', err);
            return undefined;
        }
    }

    async epochsParameters(epochNo) {
        // console.log("getEpochsParameters  epochNo: ", epochNo);
        const data = {
            "epochNo": epochNo
        };

        let reqPath = '/getEpochsParameters';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - getEpochsParameters, e: ', err);
            return undefined;
        }
    }

    async queryEraSummaries() {
        // console.log("getEpochsParameters  epochNo: ", epochNo);
        const data = {
        };

        let reqPath = '/queryEraSummaries';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - queryEraSummaries, e: ', err);
            return undefined;
        }
    }

    async queryGenesisConfig(epochNo) {
        // console.log("getEpochsParameters  epochNo: ", epochNo);
        const data = {
        };

        let reqPath = '/queryGenesisConfig';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - queryGenesisConfig, e: ', err);
            return undefined;
        }
    }

    async getBalancedConfig(epochNo) {
        // console.log("getEpochsParameters  epochNo: ", epochNo);
        const data = {
        };

        let reqPath = '/getBalancedConfig';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - getBalancedConfig, e: ', err);
            return undefined;
        }
    }

    async blocksLatest() {
        const data = {
        };
        let reqPath = '/getLatestBlock';
        
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - getLatestBlock, e: ', err);
            return undefined;
        }
    }

    async blocks(number) {
        let data = {
            "blockNo": number
        };
        let reqPath = '/getBlock';

        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getBlockByHeight, e: ', err);
            return undefined;
        }
    }

    async addressBalance(address) {
        let data = {
            "address": address
        };

        let reqPath = '/getBalanceByAddress';

        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - getAddressBalance, e: ', err);
            return undefined;
        }
    }

    async addressesUtxos(address, pagination) {

        let data = {
            "address": address
        };

        let reqPath = '/getAddressUTXOs';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;

        }catch(err){
            console.error('WanOgmiosApi - getAddressUTXOs, e: ', err);
            return undefined;
        }
    }

    async addressesUtxosAll(address, allMethodOptions) {

        let data = {
            "address": address
        };

        let reqPath = '/getAddressUTXOs';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getAddressUTXOs, e: ', err);
            return undefined;
        }
    }

    async addressesTransactions(address, pagination, additionalOptions) {

        let data = {
            "address": address,
            "fromBlock": additionalOptions.from,
            "toBlock": additionalOptions.to
        };

        let reqPath = '/getAddressTx';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getAddressTx, e: ', err);
            return undefined;
        }
    }

    async addressesTransactionsAll(address, allMethodOptions, additionalOptions) {

        let data = {
            "address": address,
            "fromBlock": additionalOptions.from,
            "toBlock": additionalOptions.to
        };

        let reqPath = '/getAddressTx';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getAddressTx, e: ', err);
            return undefined;
        }
    }

    async txSubmit(signedTx) {
        const strTxRaw = Buffer.from(signedTx).toString('hex');
        console.error('WanOgmiosApi - txSubmit strTxRaw: ', strTxRaw);
        
        let data = {
            "rawTx": strTxRaw
        };

        let reqPath = '/sendSignedTx';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            console.log('txSubmit: ', res);  
            if(undefined === res){
                return undefined;
            }          
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - sendSignedTx, e: ', err);
            return undefined;
        }
    }

    async evaluateTx(signedTx) {
        const strTxRaw = Buffer.from(signedTx).toString('hex');
        console.error('WanOgmiosApi - evaluateTx strTxRaw: ', strTxRaw);
        
        let data = {
            "rawTx": strTxRaw
        };

        let reqPath = '/evaluateTx';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            console.log('evaluateTx: ', res);  
            if(undefined === res){
                return undefined;
            }          
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - evaluateTx, e: ', err);
            return undefined;
        }
    }

    async txsUtxos(strTxId) {
        
        let data = {
            "txId": strTxId
        };

        let reqPath = '/getTxUtxos';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getTxUtxos, e: ', err);
            return undefined;
        }
    }

    async txs(strTxId) {
        
        let data = {
            "txId": strTxId
        };

        let reqPath = '/getTxById';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getTxById, e: ', err);
            return undefined;
        }
    }

    async txsMetadata(strTxId) {
        
        let data = {
            "txId": strTxId
        };

        let reqPath = '/getTxsMetadata';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - getTxsMetadata, e: ', err);
            return undefined;
        }
    }

    async deriveAddress(publicKey, addressIndex, type, isTestnet) {
        
        let data = {
            "publicKey": publicKey,
            "addressIndex": addressIndex,
            "type": type,
            "isTestnet": isTestnet
        };

        let reqPath = '/deriveAddress';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - deriveAddress, e: ', err);
            return undefined;
        }
    }

    async metadataTxsLabel(label, additionalOptions) {

        let data = {
            "label": label,
            "from": additionalOptions.from,
            "to":  additionalOptions.to 
        };

        let reqPath = '/getTxsBylabel';
        try{
            let res = await axios.post(this.ogmiosUrl + reqPath, data);
            // console.log('Body: ', res.data);            
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
            
        }catch(err){
            console.error('WanOgmiosApi - metadataTxsLabel, e: ', err);
            return undefined;
        }
    }

    async addressesUtxosWithBlockHeight(address) {

        let data = {
            "address": address
        };

        let reqPath = '/getAddressUTXOsWithBlockHeight';
        let res;
        try{
            res = await axios.post(this.ogmiosUrl + reqPath, data);
            console.log('getAddressUTXOsWithBlockHeight Body: ', res.data.length);           
            let ret = ('' === res.data)?undefined:res.data;
            return ret;
        }catch(err){
            console.log('WanOgmiosApi - getAddressUTXOsWithBlockHeight, e: ', err);
            throw err;
        }
        
    }

}

module.exports = WanOgmiosApi;

