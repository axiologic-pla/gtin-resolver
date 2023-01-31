const errorUtils = require("../errors/errorUtils");

function verifyIfLeafletMessage(message) {
  return ["leaflet", "smpc"].includes(message.messageType)
    && Object.keys(message).some(key => ['productCode', 'batchCode'].includes(key))
    && (message.action === "add" || message.action === "update")
}

const acceptedFileExtensions = ["xml", "apng", "avif", "gif", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "png", "svg", "webp", "bmp", "ico", "cur"];

async function processLeafletMessage(message) {
  const schema = require("./leafletSchema");
  const validationUtils = require("../../utils/ValidationUtils");
  const leafletUtils = require("./leafletUtils");
  const logUtils = require("../../utils/LogUtils");
  const utils = require("../utils");
  const errorUtils = require("../errors/errorUtils");
  const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();

  const {sanitize} = require("../../utils/htmlSanitize");
  this.mappingLogService = logUtils.createInstance(this.storageService, this.options.logService);

  await validationUtils.validateMessageOnSchema.call(this, message, schema);
  if (message.messageType === "smpc") {
    errorUtils.addMappingError("MVP1_RESTRICTED");
    throw errMap.newCustomError(errMap.errorTypes.MVP1_RESTRICTED, "smpc");
    return;
  }

  message.otherFilesContent.forEach(fileObj => {
    const splitFileName = fileObj.filename.split(".");
    const fileExtension = splitFileName[splitFileName.length - 1];
    const index = acceptedFileExtensions.findIndex(acceptedExtension => acceptedExtension === fileExtension);
    if (index === -1) {
      errorUtils.addMappingError("UNSUPPORTED_FILE_FORMAT");
      throw errMap.newCustomError(errMap.errorTypes.UNSUPPORTED_FILE_FORMAT, message.messageType);
    }
    try {
      fileObj.fileContent = sanitize(fileObj.fileContent);
    } catch (e) {
      errorUtils.addMappingError("FILE_CONTAINS_FORBIDDEN_TAGS");
      throw errMap.newCustomError(errMap.errorTypes.FILE_CONTAINS_FORBIDDEN_TAGS, message.messageType);
    }
  });

  let language = message.language;
  let type = message.messageType

  let basePath = leafletUtils.getLeafletDirPath(type, language);
  let xmlFilePath = leafletUtils.getLeafletPath(type, language);
  let base64ToArrayBuffer = require("../../utils/CommonUtils").base64ToArrayBuffer;


  let base64XMLFileContent = message.xmlFileContent;
  try {
    base64XMLFileContent = sanitize(base64XMLFileContent);
  } catch (e) {
    errorUtils.addMappingError("FILE_CONTAINS_FORBIDDEN_TAGS");
    throw errMap.newCustomError(errMap.errorTypes.FILE_CONTAINS_FORBIDDEN_TAGS, message.messageType);
  }

  let arrayBufferXMLFileContent = base64ToArrayBuffer(base64XMLFileContent);

  const {hostDSU, hostMetadata} = await leafletUtils.getHostDSUData.call(this, message);


  try {

    let args = [hostDSU, type];
    const basicCb = function(err){
      if(err){
        console.log(err);
      }
    };

    let gtin = hostMetadata.productCode;
    if(message.batchCode){
      //leaflet on batch
      args = args.concat([gtin, language, message.batchCode, hostMetadata.expiryDate, hostMetadata.epiLeafletVersion]);
    }else{
      gtin = hostMetadata.gtin;
      //leaflet on product
      args = args.concat([gtin, language, undefined, undefined, undefined]);
    }

    //triggering fixedUrl registration and a cleanup if needed...
    try{
      await $$.promisify(require("./../utils.js").registerGtinOwnerFixedUrl)(hostDSU, gtin);
      await $$.promisify(require("./../utils.js").registerLeafletFixedUrl)(...args);
      await $$.promisify(require("./../utils.js").deactivateLeafletFixedUrl)(hostDSU, gtin);
    }catch(err){
      //if cleanup fails mapping needs to fail...
      console.log("Leaflet Mapping failed due to", err);
      const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
      const errorUtils = require("../errors/errorUtils");
      errorUtils.addMappingError("NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER");
      throw errMap.newCustomError(errMap.errorTypes.NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER, message.messageType);
    }


    if (message.action === "update") {
      await hostDSU.delete(basePath, {ignoreError: true});
    }

    await hostDSU.writeFile(xmlFilePath, $$.Buffer.from(arrayBufferXMLFileContent));

    for (let i = 0; i < message.otherFilesContent.length; i++) {
      let file = message.otherFilesContent[i];
      let filePath = `${basePath}/${file.filename}`;
      await hostDSU.writeFile(filePath, $$.Buffer.from(base64ToArrayBuffer(file.fileContent)));
    }

    let languages = await $$.promisify(hostDSU.listFolders)(`/${type}`);

    let diffs = {
      type: message.messageType,
      language: message.language,
      action: message.action
    };

    let logData = await this.mappingLogService.logSuccessAction(message, hostMetadata, true, diffs, hostDSU);
    await utils.increaseVersion(this, message);

    //triggering the creation of fixedUrls for the gtinOwner
    require("./../utils.js").activateGtinOwnerFixedUrl(hostDSU, gtin, basicCb);

    //triggering the creation of fixedUrls for the leaflet
    require("./../utils.js").activateLeafletFixedUrl(hostDSU, gtin, basicCb);
  } catch (e) {
    console.log("Leaflet Mapping failed because of", e);

    const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
    const errorUtils = require("../errors/errorUtils");
    errorUtils.addMappingError("WRITING_FILE_FAILED");
    throw errMap.newCustomError(errMap.errorTypes.WRITING_FILE_FAILED, message.messageType);
  }
}

require("opendsu").loadApi("m2dsu").defineMapping(verifyIfLeafletMessage, processLeafletMessage);
