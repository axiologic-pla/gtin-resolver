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
    const errorUtils = require("../errors/errorUtils");
    const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();

    const {sanitize} = require("../../utils/htmlSanitize");
    this.mappingLogService = logUtils.createInstance(this.storageService, this.options.logService);

    // await validationUtils.validateMessageOnSchema.call(this, message, schema);
    if (message.messageType === "smpc") {
        errorUtils.addMappingError("MVP1_RESTRICTED");
        throw errMap.newCustomError(errMap.errorTypes.MVP1_RESTRICTED, "smpc");
    }

    message.otherFilesContent.forEach(fileObj => {
        const splitFileName = fileObj.filename.split(".");
        const fileExtension = splitFileName[splitFileName.length - 1];
        const index = acceptedFileExtensions.findIndex(acceptedExtension => acceptedExtension === fileExtension.toLowerCase());
        if (index === -1) {
            errorUtils.addMappingError("UNSUPPORTED_FILE_FORMAT");
            throw errMap.newCustomError(errMap.errorTypes.UNSUPPORTED_FILE_FORMAT, message.messageType);
        }
        //big images can cause  Maximum call stack size exceeded
        /*try {
          fileObj.fileContent = sanitize(fileObj.fileContent);
        } catch (e) {
          errorUtils.addMappingError("FILE_CONTAINS_FORBIDDEN_TAGS");
          throw errMap.newCustomError(errMap.errorTypes.FILE_CONTAINS_FORBIDDEN_TAGS, message.messageType);
        }*/
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


    const {hostDSU, hostMetadata} = await leafletUtils.getHostDSUData.call(this, message);
    let anchoringDomain = this.options.holderInfo.domain;
    let brickingDomain = this.options.holderInfo.subdomain;
    let args = [anchoringDomain, brickingDomain, type];
    let gtin = hostMetadata.gtin;
    errorUtils.addMappingError("WRONG_XML_FORMAT");
    errorUtils.addMappingError("WRONG_XML_IMG_SRC_TO_FILES_MAPPING", (data) => {
        return data.map(item => {
            return {
                errorType: this.errCode,
                errorMessage: this.errMsg,
                errorDetails: `Image ${item} does not exist`,
                errorField: item.field
            }
        })
    });
    let leafletHtmlContent;
    let htmlXMLContent
    try {
        let xmlDisplayService = leafletUtils.getService(hostDSU, gtin, type);

        //remove BOM-utf8 chars from the begining of the xml
        if (base64XMLFileContent.substring(0, 4) === '77u/') {
            base64XMLFileContent = base64XMLFileContent.substring(4)
        }
        htmlXMLContent = xmlDisplayService.getHTMLFromXML("", atob(base64XMLFileContent));

        leafletHtmlContent = xmlDisplayService.buildLeafletHTMLSections(htmlXMLContent);
    } catch (e) {
        console.log(e);
        leafletHtmlContent = null;
    }
    let differentCaseImgFiles = [];
    if (!leafletHtmlContent) {
        throw errMap.newCustomError(errMap.errorTypes.WRONG_XML_FORMAT, message.messageType);
    } else {
        let htmlImageNames = Array.from(htmlXMLContent.querySelectorAll("img")).map(img => img.getAttribute("src"))
        //removing from validation image src that are data URLs ("data:....")
        htmlImageNames = htmlImageNames.filter((imageSrc) => {
            let dataUrlRegex = new RegExp(/^\s*data:([a-z]+\/[a-z]+(;[a-z-]+=[a-z-]+)?)?(;base64)?,[a-z0-9!$&',()*+;=\-._~:@/?%\s]*\s*$/i);
            if (!!imageSrc.match(dataUrlRegex) || imageSrc.startsWith("data:")) {
                return false;
            }
            return true;
        });

        let uploadedImageNames = message.otherFilesContent.map(fileObj => {
            return fileObj.filename
        })

        let missingImgFiles = [];
        htmlImageNames.forEach(htmlImgName => {

            let differentImg = uploadedImageNames.find((item) => item.toLowerCase() === htmlImgName.toLowerCase())

            if (!differentImg) {
                missingImgFiles.push({
                    field: htmlImgName,
                    message: `does not exist`
                });
            } else {
                if (htmlImgName !== differentImg) {
                    differentCaseImgFiles.push(htmlImgName)
                }
            }
        })
        if (missingImgFiles.length > 0) {
            message.invalidFields = missingImgFiles;
            throw errMap.newCustomError(errMap.errorTypes.WRONG_XML_IMG_SRC_TO_FILES_MAPPING, missingImgFiles);
        }
    }

    try {
        if (message.batchCode) {
            //leaflet on batch
            args = args.concat([gtin, language, message.batchCode]);
            args = args.concat([require("./../../utils/CommonUtils.js").convertFromGS1DateToYYYY_HM(hostMetadata.expiry), hostMetadata.epiLeafletVersion]);
        } else {
            //leaflet on product
            args = args.concat([gtin, language, undefined, undefined, undefined]);
        }

        //triggering fixedUrl registration and a cleanup if needed...
        try {
            await require("./../utils.js").registerGtinOwnerFixedUrlByDomainAsync(anchoringDomain, gtin);
            await require("./../utils.js").registerLeafletFixedUrlByDomainAsync(...args);
            if (message.batchCode) {
                //we are in batch case... let's register a fixedUrl without expiry date
                let newArgs = [anchoringDomain, brickingDomain, type, gtin, language, message.batchCode, undefined, hostMetadata.epiLeafletVersion];
                await require("./../utils.js").registerLeafletFixedUrlByDomainAsync(...newArgs);
            }
            await require("./../utils.js").deactivateLeafletFixedUrlAsync(hostDSU, brickingDomain, gtin);
        } catch (err) {
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
        let arrayBufferXMLFileContent = base64ToArrayBuffer(base64XMLFileContent);
        await hostDSU.writeFile(xmlFilePath, $$.Buffer.from(arrayBufferXMLFileContent));
        let warnLogMessage = [];
        for (let i = 0; i < message.otherFilesContent.length; i++) {
            let file = message.otherFilesContent[i];
            let differentCaseFileName = differentCaseImgFiles.find(item => file.filename.toLowerCase() === item.toLowerCase());
            if (differentCaseFileName) {
                warnLogMessage.push(`Image ${differentCaseFileName} does not exist, but a similar file ${file.filename}  exists and will be used instead`)
                file.filename = differentCaseFileName;
            }
            let filePath = `${basePath}/${file.filename}`;
            await hostDSU.writeFile(filePath, $$.Buffer.from(base64ToArrayBuffer(file.fileContent)));
        }

        let diffs = {
            type: message.messageType,
            language: message.language,
            action: message.action
        };

        if (warnLogMessage.length > 0) {
            diffs.additionalInfo = warnLogMessage
        }

        await leafletUtils.updateVersionOnTarget(this, message, hostDSU, hostMetadata);
        hostDSU.onCommitBatch(async () => {
            await this.mappingLogService.logSuccessAction(message, hostMetadata, true, diffs, hostDSU);
        }, true);

        //triggering the creation of fixedUrls for the gtinOwner
        require("./../utils.js").activateGtinOwnerFixedUrl(hostDSU, anchoringDomain, gtin);

        //triggering the creation of fixedUrls for the leaflet
        require("./../utils.js").activateLeafletFixedUrl(hostDSU, brickingDomain, gtin);
    } catch (e) {
        console.log("Leaflet Mapping failed because of", e);

        const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
        const errorUtils = require("../errors/errorUtils");
        errorUtils.addMappingError("WRITING_FILE_FAILED");
        throw errMap.newCustomError(errMap.errorTypes.WRITING_FILE_FAILED, message.messageType);
    }
}

require("opendsu").loadApi("m2dsu").defineMapping(verifyIfLeafletMessage, processLeafletMessage);
