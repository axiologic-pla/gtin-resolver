const openDSU = require("opendsu");
const resolver = openDSU.loadAPI("resolver");
const UploadTypes = require("./UploadTypes");
const Languages = require("./Languages");
const constants = require("../constants/constants");
const utils = require("./CommonUtils");

const LEAFLET_CARD_STATUS = {
    NEW: "add",
    UPDATE: "update",
    EXISTS: "exists",
    DELETE: "delete"
}

function generateCard(action, type, code, files, videoSource) {
    let card = {
        action: action,
        type: {value: type},
        language: {value: code},
        files: files,
        videoSource: videoSource
    };
    card.type.label = UploadTypes.getLanguage(type);
    card.language.label = Languages.getLanguageName(code);
    return card;
}

async function getXMLFileContent(files, callback) {
    let xmlFiles = files.filter((file) => file.name.endsWith('.xml'));

    if (xmlFiles.length === 0) {
        return callback(new Error("No xml files found."))
    }
    return await getBase64FileContent(xmlFiles[0], callback)
}

async function getOtherCardFiles(files, callback) {
    let anyOtherFiles = files.filter((file) => !file.name.endsWith('.xml'))

    let filesContent = [];
    for (let i = 0; i < anyOtherFiles.length; i++) {
        let file = anyOtherFiles[i];
        filesContent.push({
            filename: file.name,
            fileContent: await $$.promisify(getBase64FileContent)(file)
        })
    }
    callback(undefined, filesContent);
}

async function getFileContent(file, methodName = "readAsText") {
    let fileReader = new FileReader();
    return new Promise((resolve, reject) => {
        fileReader.onload = function () {
            return resolve(fileReader.result)
        }
        fileReader.onerror = function () {
            return reject()
        }
        fileReader[methodName](file);
    })
}

async function getFileContentAsBuffer(file) {
    return getFileContent(file, "readAsArrayBuffer");
}

async function getBase64FileContent(file, callback) {
    let content;
    try {
        content = await getFileContentAsBuffer(file);
        content = utils.arrayBufferToBase64(content);
    } catch (e) {
        return callback(e);
    }
    return callback(undefined, content);
}


function generateRandom(n) {
    let add = 1,
        max = 12 - add;

    if (n > max) {
        return generateRandom(max) + generateRandom(n - max);
    }

    max = Math.pow(10, n + add);
    let min = max / 10; // Math.pow(10, n) basically
    let number = Math.floor(Math.random() * (max - min + 1)) + min;

    return ("" + number).substring(add);
}

async function createEpiMessages(data, attachedTo) {
    let cardMessages = [];

    for (let i = 0; i < data.cards.length; i++) {
        let card = data.cards[i];

        if (card.action !== LEAFLET_CARD_STATUS.EXISTS) {

            let cardMessage = {
                messageTypeVersion: data.messageTypeVersion,
                senderId: data.senderId,
                receiverId: "",
                messageId: generateRandom(13),
                messageDateTime: data.messageDateTime,
                token: "",
                action: card.action,
                language: card.language.value,
                messageType: card.type.value,

            }
            try {
                if (card.action !== LEAFLET_CARD_STATUS.DELETE) {
                    cardMessage.xmlFileContent = await $$.promisify(getXMLFileContent)(card.files);
                    cardMessage.otherFilesContent = await $$.promisify(getOtherCardFiles)(card.files);
                }
            } catch (e) {
                console.log('err ', e);
            }

            if (attachedTo === "product") {
                cardMessage.productCode = data.code;
            } else {
                if (data.productCode) {
                    cardMessage.productCode = data.productCode;
                }
                cardMessage.batchCode = data.code;
            }
            cardMessages.push(cardMessage);
        }
    }


    return cardMessages;
}

async function getLanguageTypeCards(model, dsuObj, folderName) {
    let cards = [];
    let folders = await $$.promisify(dsuObj.listFolders)(`/${folderName}`);
    for (const languageCode of folders) {
        let files = await $$.promisify(dsuObj.listFiles)(`/${folderName}/${languageCode}`);
        let videoSource = "";
        if (model.videos && model.videos[`${folderName}/${languageCode}`]) {
            videoSource = atob(model.videos[`${folderName}/${languageCode}`]);
        }
        cards.push(generateCard(LEAFLET_CARD_STATUS.EXISTS, `${folderName}`, languageCode, files, videoSource));
    }
    return cards;
}

async function getLeafletFile(leafletType, leafletLang, fileName, model) {
    let {gtinSSI, mountPath} = await getDSUBaseInfo(model);
    let constDSU = await $$.promisify(resolver.loadDSU)(gtinSSI);
    let content = await $$.promisify(constDSU.readFile)(`${mountPath}/${leafletType}/${leafletLang}/${fileName}`);
    return content;
}

async function getDSUBaseInfo(model) {
    let gtinSSI, mountPath;
    if (model.product) {
        mountPath = constants.PRODUCT_DSU_MOUNT_POINT;
        gtinSSI = await getGtinSSI(model.product.gtin);
    } else {
        mountPath = constants.BATCH_DSU_MOUNT_POINT;
        gtinSSI = await getGtinSSI(model.batch.gtin, model.batch.batchNumber);
    }
    return {gtinSSI, mountPath}
}

function getDSUAttachments(model, disabledFeatures, callback) {
    const gtinResolver = require("gtin-resolver");
    const config = openDSU.loadAPI("config");
    config.getEnv("epiDomain", async (err, domain) => {
        if (err) {
            return callback(err);
        }

        const subdomain = await $$.promisify(config.getEnv)("epiSubdomain")
        let gtinSSI;
        let mountPath;
        if (model.batchNumber) {
            gtinSSI = gtinResolver.createGTIN_SSI(domain, subdomain, model.gtin, model.batchNumber);
            mountPath = constants.BATCH_DSU_MOUNT_POINT;
        } else {
            gtinSSI = gtinResolver.createGTIN_SSI(domain, subdomain, model.gtin)
            mountPath = constants.PRODUCT_DSU_MOUNT_POINT;
        }

        resolver.loadDSU(gtinSSI, async (err, constDSU) => {
            if (err) {
                return callback(err);
            }

            //used temporarily to avoid the usage of dsu cached instances which are not up to date
            try {
                const context = await $$.promisify(constDSU.getArchiveForPath)(mountPath);
                let dsuObj = context.archive;
                await $$.promisify(dsuObj.load)();
                let languageTypeCards = [];
                if (!disabledFeatures.includes("01")) {
                    languageTypeCards = languageTypeCards.concat(await getLanguageTypeCards(model, dsuObj, "leaflet"));
                }
                if (!disabledFeatures.includes("04")) {
                    languageTypeCards = languageTypeCards.concat(await getLanguageTypeCards(model, dsuObj, "smpc"));
                }

                try {
                    let stat = await $$.promisify(dsuObj.stat)(constants.PRODUCT_IMAGE_FILE)
                    if (stat.type === "file") {
                        let data = await $$.promisify(dsuObj.readFile)(constants.PRODUCT_IMAGE_FILE);
                        let productPhoto = utils.getImageAsBase64(data);
                        return callback(undefined, {languageTypeCards: languageTypeCards, productPhoto: productPhoto});
                    }
                } catch (err) {
                    // if model is not a product or there is no image in dsu do not return a product photo
                }

                return callback(undefined, {languageTypeCards: languageTypeCards});
            } catch (e) {
                return callback(e);
            }
        });
    });
}

function getMetadata(gtinSSI, targetFilePath, callback) {
    resolver.loadDSU(gtinSSI, async (err, constDSU) => {
        if (err) {
            return callback(err);
        }
        constDSU.readFile(targetFilePath, (err, content) => {
            if (err) {
                return callback(err);
            }
            return callback(undefined, JSON.parse(content.toString()));
        });
    });
}

async function getEnvDetails() {
    const config = openDSU.loadAPI("config");
    const domain = await $$.promisify(config.getEnv)("epiDomain");
    const subdomain = await $$.promisify(config.getEnv)("epiSubdomain")

    return {domain, subdomain};
}

async function getGtinSSI(gtin, batchNumber) {
    let {domain, subdomain} = await getEnvDetails();
    const gtinResolver = require("gtin-resolver");
    let gtinSSI = gtinResolver.createGTIN_SSI(domain, subdomain, gtin, batchNumber);
    return gtinSSI;
}

function checkExistenceForSSI(ssi, callback) {
    const anchoring = require("opendsu").loadApi("anchoring");
    const anchoringX = anchoring.getAnchoringX();
    anchoringX.getLastVersion(ssi, (err, version) => {
        if (err) {
            return callback(err);
        }
        callback(undefined, !!version);
    });
}

async function checkIfWeHaveDataForThis(gtin, batchNumber, callback) {
    const ssi = await getGtinSSI(gtin, batchNumber);
    checkExistenceForSSI(ssi, callback);
}

async function getProductMetadata(gtin, callback) {
    let {domain, subdomain} = await getEnvDetails();
    const gtinResolver = require("gtin-resolver");
    let gtinSSI = gtinResolver.createGTIN_SSI(domain, subdomain, gtin);
    let targetFilePath = require("../EpiVersionTransformer").getProductPath(1);
    getMetadata(gtinSSI, targetFilePath, callback);
}

async function getBatchMetadata(batchNumber, gtin, callback) {
    let {domain, subdomain} = await getEnvDetails();
    const gtinResolver = require("gtin-resolver");
    let gtinSSI = gtinResolver.createGTIN_SSI(domain, subdomain, gtin, batchNumber);
    let targetFilePath = require("../EpiVersionTransformer").getBatchPath(1);
    getMetadata(gtinSSI, targetFilePath, callback);
}

module.exports = {
    checkIfWeHaveDataForThis,
    generateCard,
    createEpiMessages,
    LEAFLET_CARD_STATUS,
    getDSUAttachments,
    getProductMetadata,
    getBatchMetadata,
    getXMLFileContent,
    getOtherCardFiles,
    getBase64FileContent,
    getLeafletFile,
    getDSUBaseInfo,
    getFileContent,
    getFileContentAsBuffer
}
