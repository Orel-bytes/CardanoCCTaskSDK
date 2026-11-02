
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const query = require('./chain-utils');
const utils = require('./utils');
const cbor = require('cbor-sync');



//---------------------------------------------------------------------------------------------
// let context;
// let txSubmitclient;
// let query;
// let connectConfig;
let timer;


//---------------------------------------------------------------------------------------------

// const BlockFrostAPI = require('@blockfrost/blockfrost-js').BlockFrostAPI;
// const blockFrostApi = new BlockFrostAPI({ isTestNet: true, projectId: 'testnetuBFkbLWQvS43rZCQSrYkFFL1gnHaxt3Z' });

// const interVia = 'api';
const interVia = 'ogmios';

const costModelsLib = {
	"PlutusV1": {
		"addInteger-cpu-arguments-intercept": 100788,
		"addInteger-cpu-arguments-slope": 420,
		"addInteger-memory-arguments-intercept": 1,
		"addInteger-memory-arguments-slope": 1,
		"appendByteString-cpu-arguments-intercept": 1000,
		"appendByteString-cpu-arguments-slope": 173,
		"appendByteString-memory-arguments-intercept": 0,
		"appendByteString-memory-arguments-slope": 1,
		"appendString-cpu-arguments-intercept": 1000,
		"appendString-cpu-arguments-slope": 59957,
		"appendString-memory-arguments-intercept": 4,
		"appendString-memory-arguments-slope": 1,
		"bData-cpu-arguments": 11183,
		"bData-memory-arguments": 32,
		"blake2b_256-cpu-arguments-intercept": 201305,
		"blake2b_256-cpu-arguments-slope": 8356,
		"blake2b_256-memory-arguments": 4,
		"cekApplyCost-exBudgetCPU": 16000,
		"cekApplyCost-exBudgetMemory": 100,
		"cekBuiltinCost-exBudgetCPU": 16000,
		"cekBuiltinCost-exBudgetMemory": 100,
		"cekConstCost-exBudgetCPU": 16000,
		"cekConstCost-exBudgetMemory": 100,
		"cekDelayCost-exBudgetCPU": 16000,
		"cekDelayCost-exBudgetMemory": 100,
		"cekForceCost-exBudgetCPU": 16000,
		"cekForceCost-exBudgetMemory": 100,
		"cekLamCost-exBudgetCPU": 16000,
		"cekLamCost-exBudgetMemory": 100,
		"cekStartupCost-exBudgetCPU": 100,
		"cekStartupCost-exBudgetMemory": 100,
		"cekVarCost-exBudgetCPU": 16000,
		"cekVarCost-exBudgetMemory": 100,
		"chooseData-cpu-arguments": 94375,
		"chooseData-memory-arguments": 32,
		"chooseList-cpu-arguments": 132994,
		"chooseList-memory-arguments": 32,
		"chooseUnit-cpu-arguments": 61462,
		"chooseUnit-memory-arguments": 4,
		"consByteString-cpu-arguments-intercept": 72010,
		"consByteString-cpu-arguments-slope": 178,
		"consByteString-memory-arguments-intercept": 0,
		"consByteString-memory-arguments-slope": 1,
		"constrData-cpu-arguments": 22151,
		"constrData-memory-arguments": 32,
		"decodeUtf8-cpu-arguments-intercept": 91189,
		"decodeUtf8-cpu-arguments-slope": 769,
		"decodeUtf8-memory-arguments-intercept": 4,
		"decodeUtf8-memory-arguments-slope": 2,
		"divideInteger-cpu-arguments-constant": 85848,
		"divideInteger-cpu-arguments-model-arguments-intercept": 228465,
		"divideInteger-cpu-arguments-model-arguments-slope": 122,
		"divideInteger-memory-arguments-intercept": 0,
		"divideInteger-memory-arguments-minimum": 1,
		"divideInteger-memory-arguments-slope": 1,
		"encodeUtf8-cpu-arguments-intercept": 1000,
		"encodeUtf8-cpu-arguments-slope": 42921,
		"encodeUtf8-memory-arguments-intercept": 4,
		"encodeUtf8-memory-arguments-slope": 2,
		"equalsByteString-cpu-arguments-constant": 24548,
		"equalsByteString-cpu-arguments-intercept": 29498,
		"equalsByteString-cpu-arguments-slope": 38,
		"equalsByteString-memory-arguments": 1,
		"equalsData-cpu-arguments-intercept": 898148,
		"equalsData-cpu-arguments-slope": 27279,
		"equalsData-memory-arguments": 1,
		"equalsInteger-cpu-arguments-intercept": 51775,
		"equalsInteger-cpu-arguments-slope": 558,
		"equalsInteger-memory-arguments": 1,
		"equalsString-cpu-arguments-constant": 39184,
		"equalsString-cpu-arguments-intercept": 1000,
		"equalsString-cpu-arguments-slope": 60594,
		"equalsString-memory-arguments": 1,
		"fstPair-cpu-arguments": 141895,
		"fstPair-memory-arguments": 32,
		"headList-cpu-arguments": 83150,
		"headList-memory-arguments": 32,
		"iData-cpu-arguments": 15299,
		"iData-memory-arguments": 32,
		"ifThenElse-cpu-arguments": 76049,
		"ifThenElse-memory-arguments": 1,
		"indexByteString-cpu-arguments": 13169,
		"indexByteString-memory-arguments": 4,
		"lengthOfByteString-cpu-arguments": 22100,
		"lengthOfByteString-memory-arguments": 10,
		"lessThanByteString-cpu-arguments-intercept": 28999,
		"lessThanByteString-cpu-arguments-slope": 74,
		"lessThanByteString-memory-arguments": 1,
		"lessThanEqualsByteString-cpu-arguments-intercept": 28999,
		"lessThanEqualsByteString-cpu-arguments-slope": 74,
		"lessThanEqualsByteString-memory-arguments": 1,
		"lessThanEqualsInteger-cpu-arguments-intercept": 43285,
		"lessThanEqualsInteger-cpu-arguments-slope": 552,
		"lessThanEqualsInteger-memory-arguments": 1,
		"lessThanInteger-cpu-arguments-intercept": 44749,
		"lessThanInteger-cpu-arguments-slope": 541,
		"lessThanInteger-memory-arguments": 1,
		"listData-cpu-arguments": 33852,
		"listData-memory-arguments": 32,
		"mapData-cpu-arguments": 68246,
		"mapData-memory-arguments": 32,
		"mkCons-cpu-arguments": 72362,
		"mkCons-memory-arguments": 32,
		"mkNilData-cpu-arguments": 7243,
		"mkNilData-memory-arguments": 32,
		"mkNilPairData-cpu-arguments": 7391,
		"mkNilPairData-memory-arguments": 32,
		"mkPairData-cpu-arguments": 11546,
		"mkPairData-memory-arguments": 32,
		"modInteger-cpu-arguments-constant": 85848,
		"modInteger-cpu-arguments-model-arguments-intercept": 228465,
		"modInteger-cpu-arguments-model-arguments-slope": 122,
		"modInteger-memory-arguments-intercept": 0,
		"modInteger-memory-arguments-minimum": 1,
		"modInteger-memory-arguments-slope": 1,
		"multiplyInteger-cpu-arguments-intercept": 90434,
		"multiplyInteger-cpu-arguments-slope": 519,
		"multiplyInteger-memory-arguments-intercept": 0,
		"multiplyInteger-memory-arguments-slope": 1,
		"nullList-cpu-arguments": 74433,
		"nullList-memory-arguments": 32,
		"quotientInteger-cpu-arguments-constant": 85848,
		"quotientInteger-cpu-arguments-model-arguments-intercept": 228465,
		"quotientInteger-cpu-arguments-model-arguments-slope": 122,
		"quotientInteger-memory-arguments-intercept": 0,
		"quotientInteger-memory-arguments-minimum": 1,
		"quotientInteger-memory-arguments-slope": 1,
		"remainderInteger-cpu-arguments-constant": 85848,
		"remainderInteger-cpu-arguments-model-arguments-intercept": 228465,
		"remainderInteger-cpu-arguments-model-arguments-slope": 122,
		"remainderInteger-memory-arguments-intercept": 0,
		"remainderInteger-memory-arguments-minimum": 1,
		"remainderInteger-memory-arguments-slope": 1,
		"sha2_256-cpu-arguments-intercept": 270652,
		"sha2_256-cpu-arguments-slope": 22588,
		"sha2_256-memory-arguments": 4,
		"sha3_256-cpu-arguments-intercept": 1457325,
		"sha3_256-cpu-arguments-slope": 64566,
		"sha3_256-memory-arguments": 4,
		"sliceByteString-cpu-arguments-intercept": 20467,
		"sliceByteString-cpu-arguments-slope": 1,
		"sliceByteString-memory-arguments-intercept": 4,
		"sliceByteString-memory-arguments-slope": 0,
		"sndPair-cpu-arguments": 141992,
		"sndPair-memory-arguments": 32,
		"subtractInteger-cpu-arguments-intercept": 100788,
		"subtractInteger-cpu-arguments-slope": 420,
		"subtractInteger-memory-arguments-intercept": 1,
		"subtractInteger-memory-arguments-slope": 1,
		"tailList-cpu-arguments": 81663,
		"tailList-memory-arguments": 32,
		"trace-cpu-arguments": 59498,
		"trace-memory-arguments": 32,
		"unBData-cpu-arguments": 20142,
		"unBData-memory-arguments": 32,
		"unConstrData-cpu-arguments": 24588,
		"unConstrData-memory-arguments": 32,
		"unIData-cpu-arguments": 20744,
		"unIData-memory-arguments": 32,
		"unListData-cpu-arguments": 25933,
		"unListData-memory-arguments": 32,
		"unMapData-cpu-arguments": 24623,
		"unMapData-memory-arguments": 32,
		"verifyEd25519Signature-cpu-arguments-intercept": 53384111,
		"verifyEd25519Signature-cpu-arguments-slope": 14333,
		"verifyEd25519Signature-memory-arguments": 10
	},
	"PlutusV2": {
		"addInteger-cpu-arguments-intercept": 100788,
		"addInteger-cpu-arguments-slope": 420,
		"addInteger-memory-arguments-intercept": 1,
		"addInteger-memory-arguments-slope": 1,
		"appendByteString-cpu-arguments-intercept": 1000,
		"appendByteString-cpu-arguments-slope": 173,
		"appendByteString-memory-arguments-intercept": 0,
		"appendByteString-memory-arguments-slope": 1,
		"appendString-cpu-arguments-intercept": 1000,
		"appendString-cpu-arguments-slope": 59957,
		"appendString-memory-arguments-intercept": 4,
		"appendString-memory-arguments-slope": 1,
		"bData-cpu-arguments": 11183,
		"bData-memory-arguments": 32,
		"blake2b_256-cpu-arguments-intercept": 201305,
		"blake2b_256-cpu-arguments-slope": 8356,
		"blake2b_256-memory-arguments": 4,
		"cekApplyCost-exBudgetCPU": 16000,
		"cekApplyCost-exBudgetMemory": 100,
		"cekBuiltinCost-exBudgetCPU": 16000,
		"cekBuiltinCost-exBudgetMemory": 100,
		"cekConstCost-exBudgetCPU": 16000,
		"cekConstCost-exBudgetMemory": 100,
		"cekDelayCost-exBudgetCPU": 16000,
		"cekDelayCost-exBudgetMemory": 100,
		"cekForceCost-exBudgetCPU": 16000,
		"cekForceCost-exBudgetMemory": 100,
		"cekLamCost-exBudgetCPU": 16000,
		"cekLamCost-exBudgetMemory": 100,
		"cekStartupCost-exBudgetCPU": 100,
		"cekStartupCost-exBudgetMemory": 100,
		"cekVarCost-exBudgetCPU": 16000,
		"cekVarCost-exBudgetMemory": 100,
		"chooseData-cpu-arguments": 94375,
		"chooseData-memory-arguments": 32,
		"chooseList-cpu-arguments": 132994,
		"chooseList-memory-arguments": 32,
		"chooseUnit-cpu-arguments": 61462,
		"chooseUnit-memory-arguments": 4,
		"consByteString-cpu-arguments-intercept": 72010,
		"consByteString-cpu-arguments-slope": 178,
		"consByteString-memory-arguments-intercept": 0,
		"consByteString-memory-arguments-slope": 1,
		"constrData-cpu-arguments": 22151,
		"constrData-memory-arguments": 32,
		"decodeUtf8-cpu-arguments-intercept": 91189,
		"decodeUtf8-cpu-arguments-slope": 769,
		"decodeUtf8-memory-arguments-intercept": 4,
		"decodeUtf8-memory-arguments-slope": 2,
		"divideInteger-cpu-arguments-constant": 85848,
		"divideInteger-cpu-arguments-model-arguments-intercept": 228465,
		"divideInteger-cpu-arguments-model-arguments-slope": 122,
		"divideInteger-memory-arguments-intercept": 0,
		"divideInteger-memory-arguments-minimum": 1,
		"divideInteger-memory-arguments-slope": 1,
		"encodeUtf8-cpu-arguments-intercept": 1000,
		"encodeUtf8-cpu-arguments-slope": 42921,
		"encodeUtf8-memory-arguments-intercept": 4,
		"encodeUtf8-memory-arguments-slope": 2,
		"equalsByteString-cpu-arguments-constant": 24548,
		"equalsByteString-cpu-arguments-intercept": 29498,
		"equalsByteString-cpu-arguments-slope": 38,
		"equalsByteString-memory-arguments": 1,
		"equalsData-cpu-arguments-intercept": 898148,
		"equalsData-cpu-arguments-slope": 27279,
		"equalsData-memory-arguments": 1,
		"equalsInteger-cpu-arguments-intercept": 51775,
		"equalsInteger-cpu-arguments-slope": 558,
		"equalsInteger-memory-arguments": 1,
		"equalsString-cpu-arguments-constant": 39184,
		"equalsString-cpu-arguments-intercept": 1000,
		"equalsString-cpu-arguments-slope": 60594,
		"equalsString-memory-arguments": 1,
		"fstPair-cpu-arguments": 141895,
		"fstPair-memory-arguments": 32,
		"headList-cpu-arguments": 83150,
		"headList-memory-arguments": 32,
		"iData-cpu-arguments": 15299,
		"iData-memory-arguments": 32,
		"ifThenElse-cpu-arguments": 76049,
		"ifThenElse-memory-arguments": 1,
		"indexByteString-cpu-arguments": 13169,
		"indexByteString-memory-arguments": 4,
		"lengthOfByteString-cpu-arguments": 22100,
		"lengthOfByteString-memory-arguments": 10,
		"lessThanByteString-cpu-arguments-intercept": 28999,
		"lessThanByteString-cpu-arguments-slope": 74,
		"lessThanByteString-memory-arguments": 1,
		"lessThanEqualsByteString-cpu-arguments-intercept": 28999,
		"lessThanEqualsByteString-cpu-arguments-slope": 74,
		"lessThanEqualsByteString-memory-arguments": 1,
		"lessThanEqualsInteger-cpu-arguments-intercept": 43285,
		"lessThanEqualsInteger-cpu-arguments-slope": 552,
		"lessThanEqualsInteger-memory-arguments": 1,
		"lessThanInteger-cpu-arguments-intercept": 44749,
		"lessThanInteger-cpu-arguments-slope": 541,
		"lessThanInteger-memory-arguments": 1,
		"listData-cpu-arguments": 33852,
		"listData-memory-arguments": 32,
		"mapData-cpu-arguments": 68246,
		"mapData-memory-arguments": 32,
		"mkCons-cpu-arguments": 72362,
		"mkCons-memory-arguments": 32,
		"mkNilData-cpu-arguments": 7243,
		"mkNilData-memory-arguments": 32,
		"mkNilPairData-cpu-arguments": 7391,
		"mkNilPairData-memory-arguments": 32,
		"mkPairData-cpu-arguments": 11546,
		"mkPairData-memory-arguments": 32,
		"modInteger-cpu-arguments-constant": 85848,
		"modInteger-cpu-arguments-model-arguments-intercept": 228465,
		"modInteger-cpu-arguments-model-arguments-slope": 122,
		"modInteger-memory-arguments-intercept": 0,
		"modInteger-memory-arguments-minimum": 1,
		"modInteger-memory-arguments-slope": 1,
		"multiplyInteger-cpu-arguments-intercept": 90434,
		"multiplyInteger-cpu-arguments-slope": 519,
		"multiplyInteger-memory-arguments-intercept": 0,
		"multiplyInteger-memory-arguments-slope": 1,
		"nullList-cpu-arguments": 74433,
		"nullList-memory-arguments": 32,
		"quotientInteger-cpu-arguments-constant": 85848,
		"quotientInteger-cpu-arguments-model-arguments-intercept": 228465,
		"quotientInteger-cpu-arguments-model-arguments-slope": 122,
		"quotientInteger-memory-arguments-intercept": 0,
		"quotientInteger-memory-arguments-minimum": 1,
		"quotientInteger-memory-arguments-slope": 1,
		"remainderInteger-cpu-arguments-constant": 85848,
		"remainderInteger-cpu-arguments-model-arguments-intercept": 228465,
		"remainderInteger-cpu-arguments-model-arguments-slope": 122,
		"remainderInteger-memory-arguments-intercept": 0,
		"remainderInteger-memory-arguments-minimum": 1,
		"remainderInteger-memory-arguments-slope": 1,
		"serialiseData-cpu-arguments-intercept": 955506,
		"serialiseData-cpu-arguments-slope": 213312,
		"serialiseData-memory-arguments-intercept": 0,
		"serialiseData-memory-arguments-slope": 2,
		"sha2_256-cpu-arguments-intercept": 270652,
		"sha2_256-cpu-arguments-slope": 22588,
		"sha2_256-memory-arguments": 4,
		"sha3_256-cpu-arguments-intercept": 1457325,
		"sha3_256-cpu-arguments-slope": 64566,
		"sha3_256-memory-arguments": 4,
		"sliceByteString-cpu-arguments-intercept": 20467,
		"sliceByteString-cpu-arguments-slope": 1,
		"sliceByteString-memory-arguments-intercept": 4,
		"sliceByteString-memory-arguments-slope": 0,
		"sndPair-cpu-arguments": 141992,
		"sndPair-memory-arguments": 32,
		"subtractInteger-cpu-arguments-intercept": 100788,
		"subtractInteger-cpu-arguments-slope": 420,
		"subtractInteger-memory-arguments-intercept": 1,
		"subtractInteger-memory-arguments-slope": 1,
		"tailList-cpu-arguments": 81663,
		"tailList-memory-arguments": 32,
		"trace-cpu-arguments": 59498,
		"trace-memory-arguments": 32,
		"unBData-cpu-arguments": 20142,
		"unBData-memory-arguments": 32,
		"unConstrData-cpu-arguments": 24588,
		"unConstrData-memory-arguments": 32,
		"unIData-cpu-arguments": 20744,
		"unIData-memory-arguments": 32,
		"unListData-cpu-arguments": 25933,
		"unListData-memory-arguments": 32,
		"unMapData-cpu-arguments": 24623,
		"unMapData-memory-arguments": 32,
		"verifyEcdsaSecp256k1Signature-cpu-arguments": 43053543,
		"verifyEcdsaSecp256k1Signature-memory-arguments": 10,
		"verifyEd25519Signature-cpu-arguments-intercept": 53384111,
		"verifyEd25519Signature-cpu-arguments-slope": 14333,
		"verifyEd25519Signature-memory-arguments": 10,
		"verifySchnorrSecp256k1Signature-cpu-arguments-intercept": 43574283,
		"verifySchnorrSecp256k1Signature-cpu-arguments-slope": 26308,
		"verifySchnorrSecp256k1Signature-memory-arguments": 10
	},
	"PlutusV3": {
		"addInteger-cpu-arguments-intercept": 100788,
		"addInteger-cpu-arguments-slope": 420,
		"addInteger-memory-arguments-intercept": 1,
		"addInteger-memory-arguments-slope": 1,
		"appendByteString-cpu-arguments-intercept": 1000,
		"appendByteString-cpu-arguments-slope": 173,
		"appendByteString-memory-arguments-intercept": 0,
		"appendByteString-memory-arguments-slope": 1,
		"appendString-cpu-arguments-intercept": 1000,
		"appendString-cpu-arguments-slope": 59957,
		"appendString-memory-arguments-intercept": 4,
		"appendString-memory-arguments-slope": 1,
		"bData-cpu-arguments": 11183,
		"bData-memory-arguments": 32,
		"blake2b_256-cpu-arguments-intercept": 201305,
		"blake2b_256-cpu-arguments-slope": 8356,
		"blake2b_256-memory-arguments": 4,
		"cekApplyCost-exBudgetCPU": 16000,
		"cekApplyCost-exBudgetMemory": 100,
		"cekBuiltinCost-exBudgetCPU": 16000,
		"cekBuiltinCost-exBudgetMemory": 100,
		"cekConstCost-exBudgetCPU": 16000,
		"cekConstCost-exBudgetMemory": 100,
		"cekDelayCost-exBudgetCPU": 16000,
		"cekDelayCost-exBudgetMemory": 100,
		"cekForceCost-exBudgetCPU": 16000,
		"cekForceCost-exBudgetMemory": 100,
		"cekLamCost-exBudgetCPU": 16000,
		"cekLamCost-exBudgetMemory": 100,
		"cekStartupCost-exBudgetCPU": 100,
		"cekStartupCost-exBudgetMemory": 100,
		"cekVarCost-exBudgetCPU": 16000,
		"cekVarCost-exBudgetMemory": 100,
		"chooseData-cpu-arguments": 94375,
		"chooseData-memory-arguments": 32,
		"chooseList-cpu-arguments": 132994,
		"chooseList-memory-arguments": 32,
		"chooseUnit-cpu-arguments": 61462,
		"chooseUnit-memory-arguments": 4,
		"consByteString-cpu-arguments-intercept": 72010,
		"consByteString-cpu-arguments-slope": 178,
		"consByteString-memory-arguments-intercept": 0,
		"consByteString-memory-arguments-slope": 1,
		"constrData-cpu-arguments": 22151,
		"constrData-memory-arguments": 32,
		"decodeUtf8-cpu-arguments-intercept": 91189,
		"decodeUtf8-cpu-arguments-slope": 769,
		"decodeUtf8-memory-arguments-intercept": 4,
		"decodeUtf8-memory-arguments-slope": 2,
		"divideInteger-cpu-arguments-constant": 85848,
		"divideInteger-cpu-arguments-model-arguments-c00": 123203,
		"divideInteger-cpu-arguments-model-arguments-c01": 7305,
		"divideInteger-cpu-arguments-model-arguments-c02": -900,
		"divideInteger-cpu-arguments-model-arguments-c10": 1716,
		"divideInteger-cpu-arguments-model-arguments-c11": 549,
		"divideInteger-cpu-arguments-model-arguments-c20": 57,
		"divideInteger-cpu-arguments-model-arguments-minimum": 85848,
		"divideInteger-memory-arguments-intercept": 0,
		"divideInteger-memory-arguments-minimum": 1,
		"divideInteger-memory-arguments-slope": 1,
		"encodeUtf8-cpu-arguments-intercept": 1000,
		"encodeUtf8-cpu-arguments-slope": 42921,
		"encodeUtf8-memory-arguments-intercept": 4,
		"encodeUtf8-memory-arguments-slope": 2,
		"equalsByteString-cpu-arguments-constant": 24548,
		"equalsByteString-cpu-arguments-intercept": 29498,
		"equalsByteString-cpu-arguments-slope": 38,
		"equalsByteString-memory-arguments": 1,
		"equalsData-cpu-arguments-intercept": 898148,
		"equalsData-cpu-arguments-slope": 27279,
		"equalsData-memory-arguments": 1,
		"equalsInteger-cpu-arguments-intercept": 51775,
		"equalsInteger-cpu-arguments-slope": 558,
		"equalsInteger-memory-arguments": 1,
		"equalsString-cpu-arguments-constant": 39184,
		"equalsString-cpu-arguments-intercept": 1000,
		"equalsString-cpu-arguments-slope": 60594,
		"equalsString-memory-arguments": 1,
		"fstPair-cpu-arguments": 141895,
		"fstPair-memory-arguments": 32,
		"headList-cpu-arguments": 83150,
		"headList-memory-arguments": 32,
		"iData-cpu-arguments": 15299,
		"iData-memory-arguments": 32,
		"ifThenElse-cpu-arguments": 76049,
		"ifThenElse-memory-arguments": 1,
		"indexByteString-cpu-arguments": 13169,
		"indexByteString-memory-arguments": 4,
		"lengthOfByteString-cpu-arguments": 22100,
		"lengthOfByteString-memory-arguments": 10,
		"lessThanByteString-cpu-arguments-intercept": 28999,
		"lessThanByteString-cpu-arguments-slope": 74,
		"lessThanByteString-memory-arguments": 1,
		"lessThanEqualsByteString-cpu-arguments-intercept": 28999,
		"lessThanEqualsByteString-cpu-arguments-slope": 74,
		"lessThanEqualsByteString-memory-arguments": 1,
		"lessThanEqualsInteger-cpu-arguments-intercept": 43285,
		"lessThanEqualsInteger-cpu-arguments-slope": 552,
		"lessThanEqualsInteger-memory-arguments": 1,
		"lessThanInteger-cpu-arguments-intercept": 44749,
		"lessThanInteger-cpu-arguments-slope": 541,
		"lessThanInteger-memory-arguments": 1,
		"listData-cpu-arguments": 33852,
		"listData-memory-arguments": 32,
		"mapData-cpu-arguments": 68246,
		"mapData-memory-arguments": 32,
		"mkCons-cpu-arguments": 72362,
		"mkCons-memory-arguments": 32,
		"mkNilData-cpu-arguments": 7243,
		"mkNilData-memory-arguments": 32,
		"mkNilPairData-cpu-arguments": 7391,
		"mkNilPairData-memory-arguments": 32,
		"mkPairData-cpu-arguments": 11546,
		"mkPairData-memory-arguments": 32,
		"modInteger-cpu-arguments-constant": 85848,
		"modInteger-cpu-arguments-model-arguments-c00": 123203,
		"modInteger-cpu-arguments-model-arguments-c01": 7305,
		"modInteger-cpu-arguments-model-arguments-c02": -900,
		"modInteger-cpu-arguments-model-arguments-c10": 1716,
		"modInteger-cpu-arguments-model-arguments-c11": 549,
		"modInteger-cpu-arguments-model-arguments-c20": 57,
		"modInteger-cpu-arguments-model-arguments-minimum": 85848,
		"modInteger-memory-arguments-intercept": 0,
		"modInteger-memory-arguments-slope": 1,
		"multiplyInteger-cpu-arguments-intercept": 90434,
		"multiplyInteger-cpu-arguments-slope": 519,
		"multiplyInteger-memory-arguments-intercept": 0,
		"multiplyInteger-memory-arguments-slope": 1,
		"nullList-cpu-arguments": 74433,
		"nullList-memory-arguments": 32,
		"quotientInteger-cpu-arguments-constant": 85848,
		"quotientInteger-cpu-arguments-model-arguments-c00": 123203,
		"quotientInteger-cpu-arguments-model-arguments-c01": 7305,
		"quotientInteger-cpu-arguments-model-arguments-c02": -900,
		"quotientInteger-cpu-arguments-model-arguments-c10": 1716,
		"quotientInteger-cpu-arguments-model-arguments-c11": 549,
		"quotientInteger-cpu-arguments-model-arguments-c20": 57,
		"quotientInteger-cpu-arguments-model-arguments-minimum": 85848,
		"quotientInteger-memory-arguments-intercept": 0,
		"quotientInteger-memory-arguments-slope": 1,
		"remainderInteger-cpu-arguments-constant": 1,
		"remainderInteger-cpu-arguments-model-arguments-c00": 85848,
		"remainderInteger-cpu-arguments-model-arguments-c01": 123203,
		"remainderInteger-cpu-arguments-model-arguments-c02": 7305,
		"remainderInteger-cpu-arguments-model-arguments-c10": -900,
		"remainderInteger-cpu-arguments-model-arguments-c11": 1716,
		"remainderInteger-cpu-arguments-model-arguments-c20": 549,
		"remainderInteger-cpu-arguments-model-arguments-minimum": 57,
		"remainderInteger-memory-arguments-intercept": 85848,
		"remainderInteger-memory-arguments-minimum": 0,
		"remainderInteger-memory-arguments-slope": 1,
		"serialiseData-cpu-arguments-intercept": 955506,
		"serialiseData-cpu-arguments-slope": 213312,
		"serialiseData-memory-arguments-intercept": 0,
		"serialiseData-memory-arguments-slope": 2,
		"sha2_256-cpu-arguments-intercept": 270652,
		"sha2_256-cpu-arguments-slope": 22588,
		"sha2_256-memory-arguments": 4,
		"sha3_256-cpu-arguments-intercept": 1457325,
		"sha3_256-cpu-arguments-slope": 64566,
		"sha3_256-memory-arguments": 4,
		"sliceByteString-cpu-arguments-intercept": 20467,
		"sliceByteString-cpu-arguments-slope": 1,
		"sliceByteString-memory-arguments-intercept": 4,
		"sliceByteString-memory-arguments-slope": 0,
		"sndPair-cpu-arguments": 141992,
		"sndPair-memory-arguments": 32,
		"subtractInteger-cpu-arguments-intercept": 100788,
		"subtractInteger-cpu-arguments-slope": 420,
		"subtractInteger-memory-arguments-intercept": 1,
		"subtractInteger-memory-arguments-slope": 1,
		"tailList-cpu-arguments": 81663,
		"tailList-memory-arguments": 32,
		"trace-cpu-arguments": 59498,
		"trace-memory-arguments": 32,
		"unBData-cpu-arguments": 20142,
		"unBData-memory-arguments": 32,
		"unConstrData-cpu-arguments": 24588,
		"unConstrData-memory-arguments": 32,
		"unIData-cpu-arguments": 20744,
		"unIData-memory-arguments": 32,
		"unListData-cpu-arguments": 25933,
		"unListData-memory-arguments": 32,
		"unMapData-cpu-arguments": 24623,
		"unMapData-memory-arguments": 32,
		"verifyEcdsaSecp256k1Signature-cpu-arguments": 43053543,
		"verifyEcdsaSecp256k1Signature-memory-arguments": 10,
		"verifyEd25519Signature-cpu-arguments-intercept": 53384111,
		"verifyEd25519Signature-cpu-arguments-slope": 14333,
		"verifyEd25519Signature-memory-arguments": 10,
		"verifySchnorrSecp256k1Signature-cpu-arguments-intercept": 43574283,
		"verifySchnorrSecp256k1Signature-cpu-arguments-slope": 26308,
		"verifySchnorrSecp256k1Signature-memory-arguments": 10,
		"cekConstrCost-exBudgetCPU": 16000,
		"cekConstrCost-exBudgetMemory": 100,
		"cekCaseCost-exBudgetCPU": 16000,
		"cekCaseCost-exBudgetMemory": 100,
		"bls12_381_G1_add-cpu-arguments": 962335,
		"bls12_381_G1_add-memory-arguments": 18,
		"bls12_381_G1_compress-cpu-arguments": 2780678,
		"bls12_381_G1_compress-memory-arguments": 6,
		"bls12_381_G1_equal-cpu-arguments": 442008,
		"bls12_381_G1_equal-memory-arguments": 1,
		"bls12_381_G1_hashToGroup-cpu-arguments-intercept": 52538055,
		"bls12_381_G1_hashToGroup-cpu-arguments-slope": 3756,
		"bls12_381_G1_hashToGroup-memory-arguments": 18,
		"bls12_381_G1_neg-cpu-arguments": 267929,
		"bls12_381_G1_neg-memory-arguments": 18,
		"bls12_381_G1_scalarMul-cpu-arguments-intercept": 76433006,
		"bls12_381_G1_scalarMul-cpu-arguments-slope": 8868,
		"bls12_381_G1_scalarMul-memory-arguments": 18,
		"bls12_381_G1_uncompress-cpu-arguments": 52948122,
		"bls12_381_G1_uncompress-memory-arguments": 18,
		"bls12_381_G2_add-cpu-arguments": 1995836,
		"bls12_381_G2_add-memory-arguments": 36,
		"bls12_381_G2_compress-cpu-arguments": 3227919,
		"bls12_381_G2_compress-memory-arguments": 12,
		"bls12_381_G2_equal-cpu-arguments": 901022,
		"bls12_381_G2_equal-memory-arguments": 1,
		"bls12_381_G2_hashToGroup-cpu-arguments-intercept": 166917843,
		"bls12_381_G2_hashToGroup-cpu-arguments-slope": 4307,
		"bls12_381_G2_hashToGroup-memory-arguments": 36,
		"bls12_381_G2_neg-cpu-arguments": 284546,
		"bls12_381_G2_neg-memory-arguments": 36,
		"bls12_381_G2_scalarMul-cpu-arguments-intercept": 158221314,
		"bls12_381_G2_scalarMul-cpu-arguments-slope": 26549,
		"bls12_381_G2_scalarMul-memory-arguments": 36,
		"bls12_381_G2_uncompress-cpu-arguments": 74698472,
		"bls12_381_G2_uncompress-memory-arguments": 36,
		"bls12_381_finalVerify-cpu-arguments": 333849714,
		"bls12_381_finalVerify-memory-arguments": 1,
		"bls12_381_millerLoop-cpu-arguments": 254006273,
		"bls12_381_millerLoop-memory-arguments": 72,
		"bls12_381_mulMlResult-cpu-arguments": 2174038,
		"bls12_381_mulMlResult-memory-arguments": 72,
		"keccak_256-cpu-arguments-intercept": 2261318,
		"keccak_256-cpu-arguments-slope": 64571,
		"keccak_256-memory-arguments": 4,
		"blake2b_224-cpu-arguments-intercept": 207616,
		"blake2b_224-cpu-arguments-slope": 8310,
		"blake2b_224-memory-arguments": 4,
		"integerToByteString-cpu-arguments-c0": 1293828,
		"integerToByteString-cpu-arguments-c1": 28716,
		"integerToByteString-cpu-arguments-c2": 63,
		"integerToByteString-memory-arguments-intercept": 0,
		"integerToByteString-memory-arguments-slope": 1,
		"byteStringToInteger-cpu-arguments-c0": 1006041,
		"byteStringToInteger-cpu-arguments-c1": 43623,
		"byteStringToInteger-cpu-arguments-c2": 251,
		"byteStringToInteger-memory-arguments-intercept": 0,
		"byteStringToInteger-memory-arguments-slope": 1,
		"andByteString-cpu-arguments-intercept": 100181,
		"andByteString-cpu-arguments-slope1": 726,
		"andByteString-cpu-arguments-slope2": 719,
		"andByteString-memory-arguments-intercept": 0,
		"andByteString-memory-arguments-slope": 1,
		"orByteString-cpu-arguments-intercept": 100181,
		"orByteString-cpu-arguments-slope1": 726,
		"orByteString-cpu-arguments-slope2": 719,
		"orByteString-memory-arguments-intercept": 0,
		"orByteString-memory-arguments-slope": 1,
		"xorByteString-cpu-arguments-intercept": 100181,
		"xorByteString-cpu-arguments-slope1": 726,
		"xorByteString-cpu-arguments-slope2": 719,
		"xorByteString-memory-arguments-intercept": 0,
		"xorByteString-memory-arguments-slope": 1,
		"complementByteString-cpu-arguments-intercept": 107878,
		"complementByteString-cpu-arguments-slope": 680,
		"complementByteString-memory-arguments-intercept": 0,
		"complementByteString-memory-arguments-slope": 1,
		"readBit-cpu-arguments": 95336,
		"readBit-memory-arguments": 1,
		"writeBits-cpu-arguments-intercept": 281145,
		"writeBits-cpu-arguments-slope": 18848,
		"writeBits-memory-arguments-intercept": 0,
		"writeBits-memory-arguments-slope": 1,
		"replicateByte-cpu-arguments-intercept": 180194,
		"replicateByte-cpu-arguments-slope": 159,
		"replicateByte-memory-arguments-intercept": 1,
		"replicateByte-memory-arguments-slope": 1,
		"shiftByteString-cpu-arguments-intercept": 158519,
		"shiftByteString-cpu-arguments-slope": 8942,
		"shiftByteString-memory-arguments-intercept": 0,
		"shiftByteString-memory-arguments-slope": 1,
		"rotateByteString-cpu-arguments-intercept": 159378,
		"rotateByteString-cpu-arguments-slope": 8813,
		"rotateByteString-memory-arguments-intercept": 0,
		"rotateByteString-memory-arguments-slope": 1,
		"countSetBits-cpu-arguments-intercept": 107490,
		"countSetBits-cpu-arguments-slope": 3298,
		"countSetBits-memory-arguments": 1,
		"findFirstSetBit-cpu-arguments-intercept": 106057,
		"findFirstSetBit-cpu-arguments-slope": 655,
		"findFirstSetBit-memory-arguments": 1,
		"ripemd_160-cpu-arguments-intercept": 1964219,
		"ripemd_160-cpu-arguments-slope": 24520,
		"ripemd_160-memory-arguments": 3
	}
}

//--------------------------------------------------
module.exports.getParamProtocol = async function (via = 'ogmios') {
	if (via == 'ogmios') {
		let protocolParams = await query.currentProtocolParameters();

		const v1 = CardanoWasm.CostModel.new();
		let index = 0;
		for (const key in protocolParams.plutusCostModels[`plutus:v1`]) {
			// for (const key in costModelsLib[`PlutusV1`]) {
			v1.set(index, CardanoWasm.Int.new_i32(protocolParams.plutusCostModels[`plutus:v1`][key]));
			// v1.set(index, CardanoWasm.Int.new_i32(costModelsLib[`PlutusV1`][key]));
			index++;
		}

		const v2 = CardanoWasm.CostModel.new();
		index = 0;
		for (const key in protocolParams.plutusCostModels[`plutus:v2`]) {
			// for (const key in costModelsLib[`PlutusV2`]) {
			v2.set(index, CardanoWasm.Int.new_i32(protocolParams.plutusCostModels[`plutus:v2`][key]));
			// v2.set(index, CardanoWasm.Int.new_i32(costModelsLib[`PlutusV2`][key]));
			index++;
		}
		const v3 = CardanoWasm.CostModel.new();
		index = 0;
		for (const key in protocolParams.plutusCostModels[`plutus:v3`]) {
			// for (const key in costModelsLib[`PlutusV3`]) {
			v3.set(index, CardanoWasm.Int.new_i32(protocolParams.plutusCostModels[`plutus:v3`][key]));
			// v3.set(index, CardanoWasm.Int.new_i32(costModelsLib[`PlutusV3`][key]));
			index++;
		}
		protocolParams.costModels = CardanoWasm.Costmdls.new();
		protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v1(), v1);
		protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v2(), v2);
		protocolParams.costModels.insert(CardanoWasm.Language.new_plutus_v3(), v3);

		return protocolParams;
	} else {
		throw 'Not Support BlockFrostApi'
	}

}

module.exports.getScriptRefByScriptHash = async function (scriptRefOwnerAddr, scriptHash) {
	let refUtxo = await this.getUtxo(scriptRefOwnerAddr);
	const ref = refUtxo.find(o => {
		const { script: scriptTmp } = utils.plutusScriptFromScriptRef(o.script);
		if (!scriptTmp) return false;
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
		return await query.submitTx(Buffer.from(signedTx.to_bytes()).toString('hex'));

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

module.exports.init_ogmios = async function (hostServer) {
	query.setBaseUrl(hostServer);
}

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

module.exports.blockHeight = async function () {
	const a = await query.blockHeight();
	return a.slot;
}

module.exports.evaluateTx = async (signedTx) => {
	try {
		const cost = await query.evaluateTx(signedTx.to_hex());
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
		const cost = await query.evaluateTx(signedTxRaw);
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

module.exports.fixTxExuintByEvaluate = async function (protocolParams, costModesLib, txRaw, collateralUtxos, gasMutipl = 1) {
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

	// const costModesLib = protocolParams.costModels;//getCostModels(protocolParams);
	// const tmp = CardanoWasm.Costmdls.new();
	// tmp.insert(CardanoWasm.Language.new_plutus_v2(), costModesLib.get(CardanoWasm.Language.new_plutus_v2()));
	const hash = CardanoWasm.hash_script_data(redeemersNew, costModesLib, costModesLib);
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