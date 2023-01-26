const errorUtils = require("../errors/errorUtils");

function verifyIfDeleteLeafletMessage(message) {
  return ["leaflet", "smpc"].includes(message.messageType) && Object.keys(message).some(key => ['productCode', 'batchCode'].includes(key)) && message.action === "delete"
}

async function processDeleteLeafletMessage(message) {
  const schema = require("./leafletDeleteSchema");
  const validationUtils = require("../../utils/ValidationUtils");
  const leafletUtils = require("./leafletUtils");
  const logUtils = require("../../utils/LogUtils");
  const utils = require("../utils");
  this.mappingLogService = logUtils.createInstance(this.storageService, this.options.logService);

  await validationUtils.validateMessageOnSchema.call(this, message, schema);


  let language = message.language;
  let type = message.messageType;
  let leafletDir = leafletUtils.getLeafletDirPath(type, language);

  const {hostDSU, hostMetadata} = await leafletUtils.getHostDSUData.call(this, message);
  let diffs = {"type": type, "language": language, "action": "deleted"};

  //triggering a cleanup
  try{
    let args = [hostDSU, type];
    let gtin = hostMetadata.productCode;
    if(message.batchCode){
      //leaflet on batch
      args = args.concat([gtin, language, message.batchCode, hostMetadata.expiryDate, hostMetadata.epiLeafletVersion]);
    }else{
      gtin = hostMetadata.gtin;
      //leaflet on product
      args = args.concat([gtin, language, undefined, undefined, undefined]);
    }
    await $$.promisify(require("./../utils.js").removeFixedUrlForLeaflet)(...args);
  }catch(err){
    //if cleanup fails mapping needs to fail...

    console.log("Leaflet Mapping failed due to", err);

    const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
    const errorUtils = require("../errors/errorUtils");
    errorUtils.addMappingError("NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER");
    throw errMap.newCustomError(errMap.errorTypes.NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER, message.messageType);
  }

  try {
    await hostDSU.delete(leafletDir, {ignoreError: true});
  } catch (e) {
    console.log(e);
  }

  let logData = await this.mappingLogService.logSuccessAction(message, hostMetadata, true, diffs, hostDSU);
  await utils.increaseVersion(this, message);
}

require("opendsu").loadApi("m2dsu").defineMapping(verifyIfDeleteLeafletMessage, processDeleteLeafletMessage);
