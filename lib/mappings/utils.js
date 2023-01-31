const productUtils = require("./product/productUtils");
const batchUtils = require("./batch/batchUtils");
const utils = require("./../utils/CommonUtils.js");
const constants = require("../constants/constants");
const SmartUrl = require("opendsu").loadApi("utils").SmartUrl;

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
  //let create a wrapper over append method to ensure that no undefined variable will be added to the query
  let append = converter.searchParams.append;
  converter.searchParams.append = (name, value)=>{
    if(typeof value === "undefined"){
      return;
    }
    append.call(converter.searchParams, name, value);
  }
  converter.searchParams.append("expiry",  expiry);
  converter.searchParams.append("batch",  batchNumber);
  converter.searchParams.append("lang",  language);
  converter.searchParams.append("gtin",  gtin);
  converter.searchParams.append("leaflet_type",  leaflet_type);
  converter.searchParams.sort();
  return `/leaflets/${domain}?${converter.searchParams.toString()}`;
}

function buildGtinOwnerURL(domain, gtin){
  return `/gtinOwner/${domain}/${gtin}`;
}

function getAnchoringDomain(dsu, callback){
  const keyssi = require("opendsu").loadApi("keyssi");
  keyssi.parse(dsu.getCreationSSI()).getAnchorId((err, anchorId)=> {
    if (err) {
      return callback(err);
    }

    const targetDomain = keyssi.parse(anchorId).getDLDomain();
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
    for(let endpoint of endpoints){
      replicas.push(new SmartUrl(endpoint));
    }
    return callback(undefined, {replicas, domain: targetDomain});
  });
}

function getEndpointsBasedOnHashLink(dsu, callback) {
  //we were able to commit the new changes then we should call the fixedUrl endpoints
  dsu.getCurrentAnchoredHashLink((err, hashLink) => {
    if (err) {
      return callback(err);
    }

    let targetDomain = hashLink.getDLDomain();
    getReplicasAsSmartUrls(targetDomain, callback);
  });
}

function getEndpointsBasedOnAnchorId(dsu, callback){
  getAnchoringDomain(dsu, (err, targetDomain)=> {
    if (err) {
      return callback(err);
    }
    getReplicasAsSmartUrls(targetDomain, callback);
  });
}

function call(endpoints, body, callback){
  function executeRequest(){
    if(endpoints.length === 0){
      const msg = `Not able to activate fixedUrl`;
      console.log(msg);
      return callback(new Error(msg));
    }

    let apihubEndpoint = endpoints.shift();
    apihubEndpoint.doPut(body, {}, (err) => {
      if (err) {
        //if we get error we try to make a call to other endpoint if any
        executeRequest();
      } else {
        return callback(undefined, true);
      }
    });
  }

  executeRequest();
}

function registerLeafletFixedUrl(dsu, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback){
  getEndpointsBasedOnHashLink(dsu, (err, {replicas, domain})=>{

    if(replicas.length === 0){
      const msg = `Not able to fix the url for leaflet`;
      console.log(msg);
      return callback(new Error(msg));
    }

    let body = JSON.stringify([buildLeafletUrl(domain, leaflet_type, gtin, language, batchNumber, expiry, epiVersion)]);

    let targets = [];
    for(let replica of replicas){
      targets.push(replica.concatWith("/registerFixedURLs"));
    }

    call(targets, body, callback);
  });
}

function registerGtinOwnerFixedUrl(dsu, gtin, callback){
  getEndpointsBasedOnAnchorId(dsu, (err, {replicas, domain})=>{
    if(replicas.length === 0){
      const msg = `Not able to fix the url for gtinOwner`;
      console.log(msg);
      return callback(new Error(msg));
    }

    let body = JSON.stringify([buildGtinOwnerURL(domain, gtin)]);

    let targets = [];
    for(let replica of replicas){
      targets.push(replica.concatWith("/registerFixedURLs"));
    }

    call(targets, body, callback);
  });
}

function getActivateRelatedFixedURLHandler(getReplicasFnc){
  return function activateRelatedFixedUrl(dsu, gtin, callback){

    let originalCommit = dsu.commitBatch;
    dsu.commitBatch = function(onConflict, cb){
      if(typeof cb === "undefined"){
        cb = onConflict;
        onConflict = undefined;
      }

      originalCommit.call(dsu, onConflict, (err)=>{
        if(err){
          return cb(err);
        }

        //we were able to commit the new changes then we should call the fixedUrl endpoints
        getReplicasFnc(dsu, function(err, {replicas}){
          if(replicas.length === 0){
            const msg = `Not able to activate fixedUrls`;
            console.log(msg);
            return callback(new Error(msg));
          }
          let targets = [];
          for(let replica of replicas){
            targets.push(replica.concatWith("/activateFixedURL"));
          }

          call(targets, `url like (${gtin})`, callback);
        });

        //after we start the fixing of the urls let's let the mapping engine do its thing ...
        cb(undefined);
      });
    }
  }
}

function getDeactivateRelatedFixedURLHandler(getReplicasFnc){
  return function deactivateRelatedFixedUrl(dsu, gtin, callback){
    getReplicasFnc(dsu, function(err, {replicas}){
      if(replicas.length === 0){
        const msg = `Not able to deactivate fixedUrls`;
        console.log(msg);
        return callback(new Error(msg));
      }
      let targets = [];
      for(let replica of replicas){
        targets.push(replica.concatWith("/deactivateFixedURL"));
      }

      call(targets, `url like (${gtin})`, callback);
    });
  }
}

module.exports = {
  increaseVersion,
  registerLeafletFixedUrl,
  registerGtinOwnerFixedUrl,
  activateLeafletFixedUrl:getActivateRelatedFixedURLHandler(getEndpointsBasedOnHashLink),
  deactivateLeafletFixedUrl:getDeactivateRelatedFixedURLHandler(getEndpointsBasedOnHashLink),
  activateGtinOwnerFixedUrl:getActivateRelatedFixedURLHandler(getEndpointsBasedOnAnchorId),
  deactivateGtinOwnerFixedUrl:getDeactivateRelatedFixedURLHandler(getEndpointsBasedOnAnchorId)
}
