const axios = require('axios');


// const apiDef ={
//     'currentProtocolParameters':{},
//     'utxo':{},
//     'blockHeight':{},
//     'delegationsAndRewards':{},
//     'eraSummaries':{},
//     'genesisConfig':{},
//     'chainTip':{},

//     'evaluateTx':{},
//     'submitTx':{}
// }

const mainnetUrl = "https://nodes.wandevs.org/cardano";
const testnetUrl = "https://nodes-testnet.wandevs.org/cardano";

let apiServer = '';
// const axiosInstance = 
module.exports.setBaseUrl = function (url) {
  apiServer = url
}


module.exports.currentProtocolParameters = async function () {
  const reqUrl = `${apiServer}/${'getCurProtocolParametersByPlutusSdk'}`;
  return (await axios.post(reqUrl, {})).data;
}

module.exports.utxo = async function (filter) {
  const reqUrl = `${apiServer}/${'getUTXOsByPlutusSdk'}`;
  return (await axios.post(reqUrl, filter)).data;
}

module.exports.blockHeight = async function () {
  const reqUrl = `${apiServer}/${'getBlockHeightByPlutusSdk'}`;
  return (await axios.post(reqUrl, {})).data;
}

module.exports.delegationsAndRewards = async function (filter) {
  const reqUrl = `${apiServer}/${'getDelegationsAndRewardsByPlutusSdk'}`;
  return (await axios.post(reqUrl, filter)).data;
}

module.exports.eraSummaries = async function () {
  const reqUrl = `${apiServer}/${'getEraSummariesByPlutusSdk'}`;
  return (await axios.post(reqUrl, {})).data;
}

module.exports.genesisConfig = async function () {
  const reqUrl = `${apiServer}/${'getGenesisConfigByPlutusSdk'}`;
  return (await axios.post(reqUrl, {})).data;
}

module.exports.chainTip = async function () {
  const reqUrl = `${apiServer}/${'getChainTipByPlutusSdk'}`;
  return (await axios.post(reqUrl, {})).data;
}

module.exports.evaluateTx = async function (filter) {
  const reqUrl = `${apiServer}/${'evaluateTxByPlutusSdk'}`;
  // const reqUrl = `${apiServer}/${'evaluateTx'}`;
 // console.log(filter);
  let ret =  (await axios.post(reqUrl, filter)).data;
  Object.keys(ret).forEach((key) => {
    if (ret[key].cpu) ret[key].steps = ret[key].cpu;
  })
  return ret;
}

module.exports.submitTx = async function (filter) {
  const reqUrl = `${apiServer}/${'submitTxByPlutusSdk'}`;
  return (await axios.post(reqUrl, filter)).data;
}


this.setBaseUrl(testnetUrl);
// this.delegationsAndRewards(['stake_test1uq2lfrauuqz5f75xqp8sl3qahspa7l3ef65nzcu3fm75m7glkzhp3']).then((response)=>{
this.utxo(['addr_test1vqkhzqla4a97aja77dldcmfy6vgjxregxmg277g78f3kf5se9wfpy']).then((response) => {
  // console.log(response.data);
  // console.log('finished');
}).catch(err => {
  console.log(err);
  console.log('over')
})