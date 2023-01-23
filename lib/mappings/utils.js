const productUtils = require("./product/productUtils");
const batchUtils = require("./batch/batchUtils");
const utils = require("./../utils/CommonUtils.js");
const constants = require("../constants/constants");
const SmartUrl = require("../../../apihub-root/lightweight-pwa/js/utils/LightSmartUrl");
const increaseVersion = async (context, message) => {
  try {

    if (message.batchCode) {
      const batchId = utils.getBatchMetadataPK(message.productCode, message.batchCode);
      let batchMetadata = await batchUtils.getBatchMetadata.call(context, message, batchId);
      batchMetadata.version++;
      await $$.promisify(context.storageService.updateRecord, context.storageService)(constants.BATCHES_STORAGE_TABLE, batchMetadata.pk, batchMetadata);
    } else {
      const productCode = message.productCode;
      let productMetadata = await productUtils.getProductMetadata.call(context, message, productCode);
      productMetadata.version++;
      await $$.promisify(context.storageService.updateRecord, context.storageService)(constants.PRODUCTS_TABLE, productMetadata.pk, productMetadata);
    }
  } catch (e) {
    console.log("error", e);
  }
}

function buildLeafletUrl(domain, leaflet_type, gtin, language, batchNumber, expiry, epiVersion){
  //query params are sort on the fixedURL middleware when checking for any entry....
  //so we need to create the url that will be "hashed" with base64 into the same order and thus why
  //we will use URLSearchParams.sort function will provide the same sort mechanism on client and server
  let converter = new URL("https://non.relevant.url.com");
  converter.search = `batchNumber=${batchNumber}&expiry=${expiry}&gtin=${gtin}&language=${language}&leaflet_type=${leaflet_type}`;
  converter.searchParams.sort();
  return `/leaflets/${domain}?${converter.searchParams.toString()}`;
}

function buildGtinOwnerURL(domain, gtin){
  return `gtinOwner/${domain}/${gtin}`;
}

function buildFixedUrl(register=true, relativeUrl){
  const base64RelativeUrl = $$.Buffer.from(relativeUrl, 'utf-8').toString('base64');
  let url = register ? "/registerFixedUrl" : "/unregisterFixedUrl";
  return `${registerFixedURL}/${base64RelativeUrl}`;
}

function getAnchoringDomain(dsu, gtin, callback){
  const keyssi = require("opendsu").loadApi("keyssi");
  keyssi.parse(dsu.getCreationSSI()).getAnchorId((err, anchorId)=> {
    if (err) {
      return callback(err);
    }

    const targetDomain = anchorId.getDLDomain();
    return callback(undefined, targetDomain);
  });
}

function getReplicasAsSmartUrls(targetDomain, callback){
  const BDNS = require("opendsu").loadApi("bdns");
  BDNS.getAnchoringServices(targetDomain, (err, endpoints)=> {
    if (err) {
      return callback(err);
    }
    let replicas = [];
    for(let index of endpoints){
      replicas.push(new SmartUrl(endpoints[index]));
    }
    return callback(undefined, replicas);
  });
}

function getLeafletHandler(register=true){
  return (dsu, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback)=>{
    if(typeof callback === "undefined"){
      callback = (...args)=>{
        console.log("callback called with the following args:", ...args);
      }
    }
    //we were able to commit the new changes then we should call the fixedUrl endpoints
    dsu.getCurrentAnchoredHashLink((err, hashLink)=>{
      if(err){
        return callback(err);
      }
      const keyssi = require("opendsu").loadApi("keyssi");
      let targetDomain = keyssi.parse(hashLink).getDLDomain();
      getReplicasAsSmartUrls(targetDomain, (err, replicas)=>{
        if(err){
          return callback(err);
        }

        let fails = 0;
        let hits = 0;
        for(let index of replicas) {
          let apihubEndpoint = replicas[index];
          let url = apihubEndpoint.concatWith(buildFixedUrl(register, buildLeafletUrl(targetDomain, gtin, language, batchNumber, expiry, epiVersion)));
          //the body is not relevant to the middleware but let's send the static message
          url.doPut("leaflet", {}, (err) => {
            if (err) {
              fails++;
              console.log(`Not able to fix the url for leaflet endpoint: ${apihubEndpoint} domain: ${targetDomain}`);
            } else {
              hits++;
            }

            if (fails + hits === replicas.length) {
              return callback(undefined, {hits, fails, numberOfTargets: replicas.length});
            }
          });
        }
      });
    });
  }
}

function createFixedUrlForLeaflet(dsu, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback){
  let originalCommit = dsu.commit;
  dsu.commit = function(cb){
    originalCommit.call(dsu, (err)=>{
      if(err){
        return cb(err);
      }
      //we were able to commit the new changes then we should call the fixedUrl endpoints
      getLeafletHandler(true)(dsu, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback);

      //after we start the fixing of the urls let's let the mapping engine do its thing ...
      cb(undefined);
    });
  }
}

function getHandlerForGtinOwner(register=true){
  return (dsu, gtin, callback)=>{
    if(typeof callback === "undefined"){
      callback = (...args)=>{
        console.log("callback called with the following args:", ...args);
      }
    }
    getAnchoringDomain(dsu, gtin, (err, targetDomain)=>{
      if(err){
        return callback(err);
      }
      getReplicasAsSmartUrls(targetDomain, (err, replicas)=>{
        if(err){
          return callback(err);
        }

        let fails = 0;
        let hits = 0;
        for(let index of replicas) {
          let apihubEndpoint = replicas[index];
          let url = apihubEndpoint.concatWith(buildFixedUrl(register, buildGtinOwnerURL(targetDomain, gtin)));
          //the body is not relevant to the middleware but let's send a static message
          url.doPut("gtinOwner", {}, (err) => {
            if (err) {
              fails++;
              console.log(`Not able to fix the url for gtinOwner endpoint: ${apihubEndpoint} domain: ${targetDomain}`);
            } else {
              hits++;
            }

            if (fails + hits === replicas.length) {
              return callback(undefined, {hits, fails, numberOfTargets: replicas.length});
            }
          });
        }
      });
    });
  }
}

function createFixedUrlForGtinOwner(dsu, gtin, callback){
  getHandlerForGtinOwner(true)(dsu, gtin, callback);
}

function removeFixedUrlForLeaflet(dsu, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback){
  getLeafletHandler(false)(dsu, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback);
}

/*
* Maybe we don't need to unregister the gtinOwner request...
* */
function removeFixedUrlForGtinOwner(dsu, gtin, callback){
  getHandlerForGtinOwner(false)(dsu, gtin, callback);
}

module.exports = {
  increaseVersion,
  createFixedUrlForLeaflet,
  removeFixedUrlForLeaflet,
  createFixedUrlForGtinOwner,
  removeFixedUrlForGtinOwner
}
