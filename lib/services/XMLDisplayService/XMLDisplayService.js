const languageUtils = require("../../utils/Languages.js");
const constants = require("../../constants/constants.js");
const {createGTIN_SSI} = require("../../GTIN_SSI");
const utils = require("../../utils/CommonUtils.js");
const accordis_xslContent = require("./Acodis_StyleSheet.js");
const default_xslContent = require("./leafletXSL.js");
const {sanitize} = require("../../utils/htmlSanitize");
const openDSU = require("opendsu");

let errorMessage = "This is a valid product. However, more information about this product has not been published by the Pharmaceutical Company. Please check back later.";
let securityErrorMessage = "Due to security concerns, the leaflet cannot be displayed";

class XmlDisplayService {
    constructor(element, gtinSSI, model, xmlType, htmlContainerId) {
        this.element = element;
        this.gtinSSI = gtinSSI;
        this.xmlType = xmlType;
        this.model = model;
        this.htmlContainerId = htmlContainerId || "#leaflet-content";
    }

    static async init(element, gtinSSI, model, xmlType, htmlContainerId) {
        let service = new XmlDisplayService(element, gtinSSI, model, xmlType, htmlContainerId);
        await service.isXmlAvailable();
        return service;
    }

    async isXmlAvailable() {
        return new Promise((resolve, reject) => {
            this.getAvailableLanguagesForXmlType((err, languages) => {
                if (err) {
                    return reject(err);
                }
                if (this.xmlType === "smpc") {
                    this.model.showSmpc = !(this.model.product.practitionerInfo === null) && languages.length > 0
                }
                if (this.xmlType === "leaflet") {
                    this.model.showLeaflet = !(this.model.product.patientLeafletInfo === null) && languages.length > 0
                }

                return resolve(this.model.showSmpc || this.model.showLeaflet);
            });
        })

    }

    displayXmlForLanguage(language, callback) {
        this.readXmlFile(language, (err, xmlContent, pathBase) => {
            if (err) {
                this.displayError();
                return callback(err, null);
            }
            try {
                this.displayXmlContent(pathBase, xmlContent);
            } catch (e) {
                this.displayError();
                return callback(err, null);
            }
            return callback(null)
            // this.applyStylesheetAndDisplayXml(pathBase, xmlContent);
        });
    }

    getGtinSSIForConstProductDSU() {
        return createGTIN_SSI(this.model.networkName, undefined, this.model.product.gtin);
    }

    makeSaneCallback(callbackRef) {
        return function (...params) {
            if (callbackRef) {
                callbackRef(...params);
                callbackRef = undefined;
            }
        }
    }

    readXmlFile(language, callback) {
        let dsuResponseAvailable = false;
        callback = this.makeSaneCallback(callback);
        setTimeout(() => {
            if (!dsuResponseAvailable) {
                let error = Error("read_dsu_timeout");
                error.statusCode = 504;
                error.statusText = "read_dsu_timeout";
                callback(error);
                return;
            }
        }, constants.READ_DSU_TIMEOUT);
        this.mergeAvailableLanguages().then(languagesMap => {
            let pathToLeafletLanguage = languagesMap[language];
            let gtinSSI = this.gtinSSI;
            if (pathToLeafletLanguage.includes(constants.PRODUCT_DSU_MOUNT_POINT)) {
                gtinSSI = this.getGtinSSIForConstProductDSU();
            }
            const pathToXml = `${pathToLeafletLanguage}/${this.xmlType}.xml`;
            const openDSU = require("opendsu");
            const resolver = openDSU.loadAPI("resolver");
            resolver.loadDSU(gtinSSI, async (err, dsu) => {
                if (err) {
                    dsuResponseAvailable = true;
                    callback(err);
                    return;
                }
                try {
                    let files = await $$.promisify(dsu.listFiles)(pathToLeafletLanguage);
                    let xmlContent = await $$.promisify(dsu.readFile)(pathToXml);
                    let textDecoder = new TextDecoder("utf-8");
                    let leafletImagesObj = {};
                    this.images = {};
                    let anyOtherFiles = files.filter((file) => !file.endsWith('.xml'));
                    for (let i = 0; i < anyOtherFiles.length; i++) {
                        let filePath = `${pathToLeafletLanguage}/${anyOtherFiles[i]}`;
                        let imgFile = await $$.promisify(dsu.readFile)(filePath);
                        leafletImagesObj[anyOtherFiles[i]] = this.images[filePath] = utils.getImageAsBase64(imgFile);
                    }
                    dsuResponseAvailable = true;
                    callback(undefined, textDecoder.decode(xmlContent), `${pathToLeafletLanguage}/`, leafletImagesObj);
                    return
                } catch (e) {
                    dsuResponseAvailable = true;
                    callback(e);
                    return
                }
            })

        }).catch(err => {
            dsuResponseAvailable = true;
            callback(err);
        })
    }

    displayError(errMsg = errorMessage) {
        let errorMessageElement = this.getErrorMessageElement(errMsg);
        this.element.querySelector(this.htmlContainerId).innerHTML = "";
        this.element.querySelector(this.htmlContainerId).appendChild(errorMessageElement);
    }

    displayXmlContent(pathBase, xmlContent, images) {
        let resultDocument = this.getHTMLFromXML(pathBase, xmlContent);
        let leafletImages = resultDocument.querySelectorAll("img");
        this.images = this.images || images;
        for (let image of leafletImages) {
            //imageSrc will contain the name of the imageFile form XML
            let imageSrc = image.getAttribute("src");
            let dataUrlRegex = new RegExp(/^\s*data:([a-z]+\/[a-z]+(;[a-z-]+=[a-z-]+)?)?(;base64)?,[a-z0-9!$&',()*+;=\-._~:@/?%\s]*\s*$/i);
            if (!!imageSrc.match(dataUrlRegex) || imageSrc.startsWith("data:")) {
                //we don't alter already embedded images
                continue;
            }
            let imgObj = images.find(elem => elem.filename === imageSrc);
            if (imgObj) {
                image.setAttribute("src", imgObj.fileContent);
            }

        }
        let htmlFragment = this.buildLeafletHTMLSections(resultDocument);
        try {
            let epiContainer = this.element.querySelector(this.htmlContainerId) || document.querySelector(this.htmlContainerId)
            epiContainer.innerHTML = sanitize(htmlFragment);
        } catch (e) {
            return this.displayError(securityErrorMessage);
        }
        let leafletLinks = this.element.querySelectorAll(".leaflet-link");
        this.activateLeafletInnerLinks(leafletLinks);
    }

    activateLeafletInnerLinks(leafletLinks) {
        for (let link of leafletLinks) {
            let linkUrl = link.getAttribute("linkUrl");
            if (linkUrl.slice(0, 1) === "#") {
                link.addEventListener("click", () => {
                    document.getElementById(linkUrl.slice(1)).scrollIntoView();
                });
            }
        }
    }

    getHTMLFromXML(pathBase, xmlContent) {
        let xsltProcessor = new XSLTProcessor();
        xsltProcessor.setParameter(null, "resources_path", pathBase);
        let parser = new DOMParser();

        let xmlDoc = parser.parseFromString(xmlContent, "text/xml");
        if (!xmlDoc || !xmlDoc.children) {
            return "";
        }
        let xslContent;
        switch (xmlDoc.children[0].tagName) {
            case "root":
                let rootInnerHtml = xmlDoc.children[0].innerHTML;
                let newXmlDoc = document.implementation.createDocument(null, "document");
                try {
                    newXmlDoc.children[0].innerHTML = sanitize(rootInnerHtml);
                } catch (e) {
                    return this.displayError(securityErrorMessage);
                }
                xmlDoc = newXmlDoc;
                xslContent = accordis_xslContent;
                break
            case "document":
                if (xmlDoc.documentElement.hasAttribute("type") && xmlDoc.documentElement.getAttribute("type") === "pharmaledger-1.0") {
                    xslContent = accordis_xslContent;
                    break;
                }
                xslContent = default_xslContent;
                break
        }

        if (!xslContent) {
            return ""
        }
        let xslDoc = parser.parseFromString(xslContent, "text/xml");

        xsltProcessor.importStylesheet(xslDoc);

        let resultDocument = xsltProcessor.transformToFragment(xmlDoc, document);
        return resultDocument;
    }

    /*  buildLeafletHTMLSections(resultDocument) {
        let sectionsElements = resultDocument.querySelectorAll(".leaflet-accordion-item");
        let aboutContent = "";
        let beforeContent = "";
        let howToContent = "";
        let sideEffectsContent = "";
        let storingContent = "";
        let moreContent = "";
        sectionsElements.forEach(section => {
          let xmlCodeValue = section.getAttribute("sectionCode");
          switch (xmlCodeValue) {
            case '48780-1':
            case '34089-3':
            case '34076-0':
            case '60559-2':
              aboutContent = aboutContent + section.innerHTML;
              break;
            case '34070-3':
            case '34084-4':
            case '34086-9':
            case '69759-9':
              beforeContent = beforeContent + section.innerHTML;
              break;
            case '34068-7':
            case '43678-2':
            case '34072-9':
            case '34067-9':
            case '59845-8':
              howToContent = howToContent + section.innerHTML;
              break;
            case '34071-1':
            case '43685-7':
            case '54433-8':
            case '69762-3':
            case '34077-8':
            case '60563-4':
            case '34078-6':
              sideEffectsContent = sideEffectsContent + section.innerHTML;
              break;
            case '44425-7':
              storingContent = storingContent + section.innerHTML;
              break;
            default:
              moreContent = moreContent + section.innerHTML;

          }
        });

        let htmlFragment = ``
        return htmlFragment;
      }*/

    buildLeafletHTMLSections(resultDocument) {
        let sectionsElements = resultDocument.querySelectorAll(".leaflet-accordion-item");
        let htmlContent = "";
        sectionsElements.forEach(section => {
            htmlContent = htmlContent + section.outerHTML;
        })
        return htmlContent;
    }

    clearSearchResult(domElement) {
        let cleanHtml = domElement.innerHTML.replace(/((<mark class([a-zA-Z""=])*>)|<mark>|<\/mark>)/gim, '');
        try {
            domElement.innerHTML = sanitize(cleanHtml);
        } catch (e) {
            return this.displayError(securityErrorMessage);
        }
    }

    searchInHtml(searchQuery) {
        let domElement = this.element.querySelector(this.htmlContainerId);
        this.clearSearchResult(domElement);
        if (searchQuery === "") {
            return
        }
        const regex = new RegExp(searchQuery, 'gi');
        let resultNodes = [];
        try {

            let results = this.element.parentElement.ownerDocument.evaluate(`.//*[text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),"${searchQuery}")]]`, domElement);
            let domNode = null;

            while (domNode = results.iterateNext()) {
                // checking if the element is rendered, such that it can be highlighted and scrolled into view
                if (domNode.checkVisibility()) {
                    resultNodes.push(domNode);
                }
            }
            for (let i = 0; i < resultNodes.length; i++) {
                let text = resultNodes[i].innerHTML;
                const newText = text.replace(regex, '<mark>$&</mark>');
                try {
                    resultNodes[i].innerHTML = sanitize(newText);
                } catch (e) {
                    return this.displayError(securityErrorMessage);
                }
            }


        } catch (e) {
            // not found should not throw error just skip and wait for new input
        }
        return resultNodes;
    }

    getBatchPathToXmlType() {
        return `${constants.BATCH_DSU_MOUNT_POINT}/${this.xmlType}`;
    }

    getProductPathToXmlType() {
        return `${constants.PRODUCT_DSU_MOUNT_POINT}/${this.xmlType}`;
    }

    getAvailableLanguagesFromPath(gtinSSI, path, callback) {
        const resolver = openDSU.loadAPI("resolver");
        resolver.loadDSU(gtinSSI, (err, dsu) => {
            if (err) {
                err.isDSUError = err;
                return callback(err);
            }
            this.readLanguagesFromDSU(dsu, path, callback);
        })
    }

    readLanguagesFromDSU(dsu, path, callback) {
        const pskPath = require("swarmutils").path;
        dsu.listFolders(path, async (err, langFolders) => {
            if (err) {
                err.isDSUError = err;
                return callback(err);
            }
            let langs = [];
            for (let i = 0; i < langFolders.length; i++) {
                let langFolderPath = pskPath.join(path, langFolders[i]);
                let files = await $$.promisify(dsu.listFiles)(langFolderPath);
                let hasXml = files.find((item) => {
                    return item.endsWith("xml")
                })
                if (hasXml) {
                    langs.push(langFolders[i])
                }
            }
            return callback(undefined, langs);
        })
    }

    getAvailableLanguagesForBatch(callback) {
        this.getAvailableLanguagesFromPath(this.gtinSSI, this.getBatchPathToXmlType(), (err, langs) => {
            if (err) {
                langs = [];
                langs.isError = err;
            }
            callback(null, langs)
        })
    }

    getAvailableLanguagesForProduct(callback) {
        let gtinSSI = this.getGtinSSIForConstProductDSU();
        this.getAvailableLanguagesFromPath(gtinSSI, this.getProductPathToXmlType(), (err, langs) => {
            if (err) {
                langs = [];
                langs.isError = err;
            }
            callback(null, langs)
        });
    }

    async mergeAvailableLanguages() {
        let productLanguages = await $$.promisify(this.getAvailableLanguagesForProduct, this)();
        let batchLanguages = await $$.promisify(this.getAvailableLanguagesForBatch, this)();
        const gotError = productLanguages.isError;
        if (undefined !== gotError && undefined !== gotError.isDSUError) {
            throw gotError;
        }
        let languagesMap = {};
        const pskPath = require("swarmutils").path;
        productLanguages.forEach(prodLang => {
            languagesMap[prodLang] = pskPath.join(this.getProductPathToXmlType(), prodLang);
        });
        batchLanguages.forEach(batchLang => {
            languagesMap[batchLang] = pskPath.join(this.getBatchPathToXmlType(), batchLang);
        })
        return languagesMap;
    }

    getErrorMessageElement(errorMessage) {
        let pskLabel = document.createElement("psk-label");
        pskLabel.className = "scan-error-message";
        pskLabel.label = errorMessage;
        return pskLabel;
    }

    getAvailableLanguagesForXmlType(callback) {
        this.mergeAvailableLanguages().then(languagesMap => {
            callback(undefined, languageUtils.normalizeLanguages(Object.keys(languagesMap)));
        }).catch(callback)
    }

    activateLeafletAccordion() {
        let accordionItems = document.querySelectorAll("div.leaflet-accordion-item");
        accordionItems.forEach((accItem, index) => {
            accItem.addEventListener("click", (evt) => {
                accItem.classList.toggle("active");
                accItem.querySelector(".leaflet-accordion-item-content").addEventListener("click", (event) => {
                    event.stopImmediatePropagation();
                    event.stopPropagation();
                })
            })
        })
    }

}

module.exports = XmlDisplayService;
