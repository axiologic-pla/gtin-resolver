const XMLDisplayService = require("./../services/XMLDisplayService/XMLDisplayService");
const LeafletInfoService = require("./../services/LeafletInfoService");

function getWebLeaflet(server) {

  server.registerAccessControlAllowHeaders(["epiprotocolversion"]);
  if(server.allowFixedUrl){
    //let's make the fixedURL middleware aware of our endpoints
    server.allowFixedUrl("/leaflets/");
  }

  const logger = $$.getLogger("leaflet-web-api", "getWebLeaflet");
  server.get("/leaflets/:domain", async function (request, response) {

    let domainName = request.params.domain;
    let leaflet_type = request.query.leaflet_type || "";
    let gtin = request.query.gtin || null;
    let lang = request.query.lang || "";
    let batchNumber = request.query.batch || null;
    let expiry = request.query.expiry || null;
    let headers = request.headers;
    let epiProtocolVersion = headers.epiprotocolversion || null;

    try {
      if (!gtin) {
        logger.info(0x103, `Missing required parameter <gtin>`)
        return sendResponse(response, 400, "gtin is a required parameter. Please check api documentation")
      }
      if (!leaflet_type) {
        logger.info(0x103, `Missing required parameter <leaflet_type>`)
        return sendResponse(response, 400, "leaflet_type is a required parameter. Please check api documentation")
      }
      if (!lang) {
        logger.info(0x103, `Missing required parameter <lang>`)
        return sendResponse(response, 400, "lang is a required parameter. Please check api documentation")
      }
      let leafletInfo = await LeafletInfoService.init({gtin, batchNumber, expiry}, domainName);
      const model = {
        product: {gtin},
        networkName: domainName
      }
      let leafletXmlService = new XMLDisplayService(null, leafletInfo.gtinSSI, model, leaflet_type);
      leafletXmlService.readXmlFile(lang, async (err, xmlContent, pathBase, leafletImagesObj) => {
        if (err) {
          let errMessage = `No available XML for gtin=${gtin} language=${lang} leaflet type=${leaflet_type}`
          if (batchNumber) {
            errMessage = `${errMessage} batchNumber id=${batchNumber}`
          }

          leafletXmlService.getAvailableLanguagesForXmlType((langerr, availableLanguages) => {
            if (langerr) {
                logger.info(0x103, errMessage)
              return sendResponse(response, 404, `${errMessage}. Please check api documentation`)
            }
            return sendResponse(response, 200, JSON.stringify({
              resultStatus: "no_xml_for_lang",
              availableLanguages: availableLanguages
            }));
          });
        } else {
          let productData = await leafletInfo.getProductClientModel();
          try {
            let batchData = await leafletInfo.getBatchClientModel();
            productData.batchData = batchData;
          } catch (e) {
            // gtin only case
            productData.batchData = null;
          }
          logger.audit(0x101, "Successfully returned leaflet");
          return sendResponse(response, 200, JSON.stringify({
            resultStatus: "xml_found",
            xmlContent,
            leafletImages: leafletImagesObj,
            productData
          }));
        }
      })
    } catch (err) {
      logger.info(0x103, err.message);
      sendResponse(response, 500, err.message);
    }
  });
}


function sendResponse(response, statusCode, message) {
  response.statusCode = statusCode;
  response.end(message);
}

module.exports.getWebLeaflet = getWebLeaflet;
