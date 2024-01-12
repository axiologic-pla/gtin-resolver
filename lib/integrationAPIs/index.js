const version = 1;

const productController = require("./controllers/ProductController.js").getInstance(version);

const requestBodyJSONMiddleware = require("./utils/middlewares.js");
const storage = require("./utils/storage.js");
const {validateGTIN} = require("../utils/ValidationUtils.js");
const {isBase64ValidImage} = require("../utils/CommonUtils");

module.exports = function(server){


  //setting up the connection to lightDB and share to the services via storage apis
  //storage.setEnclaveInstance(domain);

  function productPreValidationMiddleware(req, res, next){
    const {gtin, domain} = req.params;

    //gtin validation required...
    let {isValid, message} = validateGTIN(gtin);
    if(!isValid){
      res.send(400);
      return;
    }
    //collecting and JSON parsing of productMessage
    let productMessage = req.body;

    if(!productMessage){
      res.send(400);
      return;
    }

    //maybe a ${domain} validation is required to be sure that we know the domain or else to return 404 !

    next();
  }

  function addSendMethodMiddleware(req, res, next){
    res.send = function send(statusCode, result){
      res.setHeader('Server', 'SoR integration Middleware');
      res.statusCode = statusCode;
      res.end(result);
    }

    next();
  }

  //this middleware injects the send method on res object before proceeding...
  server.use("/integration/*", addSendMethodMiddleware);

  server.put("/integration/:domain/product/:gtin", requestBodyJSONMiddleware);
  server.put("/integration/:domain/product/:gtin", productPreValidationMiddleware);
  server.put("/integration/:domain/product/:gtin", async function(req, res){
        const {gtin, domain} = req.params;

        //collecting and JSON parsing of productMessage
        let productMessage = req.body;

        try{
          productMessage = JSON.parse(productMessage);
        }catch(err){
          //can we send errors to the client?!
          res.send(415, err);
          return;
        }

        try{
          await productController.addProduct(domain, gtin, productMessage, res);
        }catch(err){
          res.send(500);
          return;
        }
  });

  server.post("/integration/:domain/product/:gtin", requestBodyJSONMiddleware);
  server.post("/integration/:domain/product/:gtin", productPreValidationMiddleware);
  server.post("/integration/:domain/product/:gtin", async function(req, res){
    const {gtin, domain} = req.params;

    //collecting and JSON parsing of productMessage
    let productMessage = req.body;

    try{
      productMessage = JSON.parse(productMessage);
    }catch(err){
      res.send(415, err);
      return;
    }

    try{
      await productController.updateProduct(domain, gtin, productMessage, res);
    }catch(err){
      res.send(500);
      return;
    }
  });

  server.get("/integration/:domain/product/:gtin", async function(req, res){
    const {gtin, domain} = req.params;

    //gtin validation required...
    let {isValid, message} = validateGTIN(gtin);
    if(!isValid){
      res.send(400);
      return;
    }

    try{
      await productController.getProduct(domain, gtin, res);
    }catch(err){
      res.send(500);
      return;
    }
  });

  server.put("/integration/:domain/addImage/:gtin", requestBodyJSONMiddleware);
  server.put("/integration/:domain/updateProduct/:gtin", productPreValidationMiddleware);
  server.put("/integration/:domain/addImage/:gtin", async function(req, res){
    const {gtin, domain} = req.params;

    //collecting and JSON parsing of productPhotoMessage
    let productPhotoMessage = req.body;

    try{
      productPhotoMessage = JSON.parse(productPhotoMessage);
    }catch(err){
      res.send(415, err);
      return;
    }

    let isValidImage = await isBase64ValidImage(productPhotoMessage.imageData)
    if (!isValidImage) {
      res.send(415, "Unsupported file format");
      return;
    }

    try{
      await productController.addImage(domain, gtin, productPhotoMessage, res);
    }catch(err){
      res.send(500);
      return;
    }
  });
}