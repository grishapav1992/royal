import {parentPort,workerData} from 'node:worker_threads';
import {independentCascadeSample} from './rtp-temple-cascade-model.mjs';
const result=independentCascadeSample(workerData.seed,workerData.rounds,p=>parentPort.postMessage({progress:p}));
parentPort.postMessage({result});
