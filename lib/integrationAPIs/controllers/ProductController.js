function ProductController(enclave, version) {
    const {getUserId} = require("../utils/getUserId");
    const logger = $$.getLogger("ProductController", "integrationsAPIs");
    const productFactory = require("../factories/ProductFactory.js").getInstance(enclave);
    const auditService = require("../services/AuditService.js").getInstance(enclave);
    const validationService = require("../services/ValidationService.js").getInstance();
    const constants = require("../utils/constants.js");
    const recoveryUtils = require("../utils/recoveryUtils.js");

    const OPERATIONS = constants.OPERATIONS;

    function prepareImageAuditEntries(userId, gtin, reqMethod) {

        let operationInProgressContext = {
            userId,
            gtin,
            operation: reqMethod === "POST" ? OPERATIONS.ADD_PRODUCT_PHOTO_IN_PROGRESS : OPERATIONS.UPDATE_PRODUCT_PHOTO_IN_PROGRESS
        }

        let failedOperationContext = {
            userId,
            gtin,
            operation: reqMethod === "POST" ? OPERATIONS.ADD_PRODUCT_PHOTO_FAIL : OPERATIONS.UPDATE_PRODUCT_PHOTO_FAIL
        }

        let successOperationContext = {
            userId,
            gtin,
            operation: reqMethod === "POST" ? OPERATIONS.ADD_PRODUCT_PHOTO : OPERATIONS.UPDATE_PRODUCT_PHOTO
        }
        return {operationInProgressContext, failedOperationContext, successOperationContext}
    }

    this.addProduct = async (domain, subdomain, gtin, productMessage, req, res) => {
        const userId = getUserId(req, productMessage);
        let product;
        try {
            await validationService.validateProductMessage(productMessage);
        } catch (err) {
            let details = err.reason || err.message;
            try {
                details = JSON.parse(details);
            } catch (err) {
                //ignorable error
            }
            res.send(422, JSON.stringify({message: "Payload validation failed", details}));
            return;
        }

        const productData = productMessage.payload;

        if (gtin !== productData.productCode) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different gtin between url params and payload."
            }));
            return;
        }

        const operationInProgressContext = {
            operation: OPERATIONS.CREATE_PRODUCT_IN_PROGRESS,
            gtin,
            userId
        }

        const failedOperationContext = {
            operation: OPERATIONS.CREATE_PRODUCT_FAIL,
            gtin,
            userId
        }

        const successOperationContext = {
            operation: OPERATIONS.CREATE_PRODUCT,
            gtin,
            userId
        }

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        try {
            product = await productFactory.createProduct(domain, subdomain, gtin, version);
            //todo: CODE-REVIEW - why do we call this function here? can we hide this in the update function before doing the update?!
            product.update(productData);
            try {
                await product.persist(successOperationContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, failedOperationContext);
                //.... return proper error to the client
                res.send(529);
                return;
            }

        } catch (err) {
            logger.error(err)
            await auditService.auditFail(auditId, failedOperationContext);
            res.send(500);
            return;
        }
        await auditService.auditProduct(auditId, JSON.parse(JSON.stringify(product)), successOperationContext);
        res.send(200);
    }

    this.updateProduct = async function (domain, subdomain, gtin, productMessage, req, res) {
        const userId = getUserId(req, productMessage);
        let product;
        try {
            await validationService.validateProductMessage(productMessage);
        } catch (err) {
            let details = err.reason || err.message;
            try {
                details = JSON.parse(details);
            } catch (err) {
                //ignorable error
            }
            res.send(422, JSON.stringify({message: "Payload validation failed", details}));
            return;
        }

        const productData = productMessage.payload;

        if (gtin !== productData.productCode) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different gtin between url params and payload."
            }));
            return;
        }

        const operationInProgressContext = {
            operation: OPERATIONS.UPDATE_PRODUCT_IN_PROGRESS,
            gtin,
            userId
        }

        const failedOperationContext = {
            operation: OPERATIONS.UPDATE_PRODUCT_FAIL,
            gtin,
            userId
        }

        const successOperationContext = {
            operation: OPERATIONS.UPDATE_PRODUCT,
            gtin,
            userId
        }

        try {
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);
            if (!product) {
                //if the product does not exist it should be created
                return this.addProduct(domain, subdomain, gtin, productMessage, req, res);
            }
        } catch (e) {
            logger.error(e)
            res.send(500, e.message);
            return;
        }

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err)
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        try {
            product.update(productData);
            try {
                await product.persist(successOperationContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, failedOperationContext);
                res.send(529);
                return;
            }

        } catch (err) {
            logger.error(err);
            await auditService.auditFail(auditId, failedOperationContext);
            res.send(500);
            return;
        }
        await auditService.auditProduct(auditId, JSON.parse(JSON.stringify(product)), successOperationContext);
        res.send(200);
    }

    this.getProduct = async (domain, subdomain, gtin, req, res) => {
        try {
            let product;
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);

            if (!product) {
                //if we don't have a product...
                res.send(404, "Product not found");
                return;
            }

            const productMetadata = JSON.stringify(product);
            return productMetadata;
        } catch (err) {
            logger.error(err);
            res.send(500, err.message);
        }
    }

    this.addImage = async (domain, subdomain, gtin, photoMessage, req, res) => {
        const userId = getUserId(req, photoMessage);
        let product;
        try {
            await validationService.validatePhotoMessage(photoMessage);
        } catch (err) {
            let details = err.reason || err.message;
            try {
                details = JSON.parse(details);
            } catch (err) {
                //ignorable error
            }
            res.send(422, JSON.stringify({message: "Payload validation failed", details}));
            return;
        }

        const {imageData} = photoMessage.payload;

        if (gtin !== photoMessage.payload.productCode) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different gtin between url params and payload."
            }));
            return;
        }

        let {
            operationInProgressContext,
            failedOperationContext,
            successOperationContext
        } = prepareImageAuditEntries(userId, gtin, req.method);

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        try {
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);
            if (!product) {
                //if we don't have a product to update ...
                await auditService.auditFail(auditId, "replace with proper fail audit data");
                res.send(404, "Product not found");
                return;
            }

            try {
                await product.addPhoto(imageData);
                successOperationContext.diffs = await product.persist(successOperationContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, failedOperationContext);
                return res.send(500, "Failed to add photo");
                //.... return proper error to the client
            }

        } catch (err) {
            logger.error(err);
            await auditService.auditFail(auditId, failedOperationContext);
            return res.send(500);
        }

        if (successOperationContext.version) {
            await auditService.auditProductVersionChange(gtin, successOperationContext.version);
        }

        await auditService.auditSuccess(auditId, successOperationContext);
        res.send(200);
    }

    this.updateImage = this.addImage;

    this.getImage = async (domain, subdomain, gtin, dsuVersion, req, res) => {
        try {
            let product;
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);

            if (!product) {
                //if we don't have a product...
                res.send(412, "Product not found");
                return;
            }
            let productPhoto;
            try {
                productPhoto = await product.getPhoto(dsuVersion);
            } catch (e) {
                logger.error(e);
                return res.send(404, "Photo not found");
            }

            return res.send(200, productPhoto);
        } catch (err) {
            logger.error(err);
            res.send(500);
        }
    }

    this.deleteImage = async (domain, subdomain, gtin, req, res) => {
        const userId = getUserId(req);
        let product;

        const operationInProgressContext = {
            operation: OPERATIONS.DELETE_PRODUCT_PHOTO_IN_PROGRESS,
            gtin,
            userId
        }

        const failedOperationContext = {
            operation: OPERATIONS.DELETE_PRODUCT_PHOTO_FAIL,
            gtin,
            userId
        }

        const successOperationContext = {
            operation: OPERATIONS.DELETE_PRODUCT_PHOTO,
            gtin,
            userId
        }

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        try {
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);

            if (!product) {
                //if we don't have a product to update ...
                await auditService.auditFail(auditId, failedOperationContext);
                res.send(404, "Product not found");
                return;
            }

            try {
                await product.deletePhoto();
                successOperationContext.diffs = await product.persist(successOperationContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, failedOperationContext);
                //.... return proper error to the client
            }

        } catch (err) {
            logger.error(err);
            await auditService.auditFail(auditId, failedOperationContext);
        }

        await auditService.auditSuccess(auditId, successOperationContext);
        res.send(200);
    }

    this.listProducts = async (start, number, query, sort) => {
        let products = await $$.promisify(enclave.filter)($$.SYSTEM_IDENTIFIER, constants.TABLES.PRODUCTS, query, sort, number);
        return products;
    }

    this.listLanguages = async (domain, subdomain, gtin, epiType, req, res) => {
        let product;
        product = await productFactory.lookupProduct(domain, subdomain, gtin, version);

        if (!product) {
            //if we don't have a product...
            res.send(404, "Product not found");
            return;
        }

        const languages = await product.listLanguages(epiType);
        return languages;
    }

    this.tryToDigest = async function (domain, subdomain, message, req, res) {
        try {
            await validationService.validateProductMessage(message);
            let gtin = message.payload.productCode;
            if (await productFactory.lookupProduct(domain, subdomain, gtin, version)) {
                await this.updateProduct(domain, subdomain, gtin, message, req, res);
                return true;
            } else {
                await this.addProduct(domain, subdomain, gtin, message, req, res);
                return true;
            }
        } catch (err) {

        }

        try {
            await validationService.validatePhotoMessage(message);
            let gtin = message.productCode;
            await this.addImage(domain, subdomain, gtin, message, req, res);
            return true;
        } catch (err) {

        }

        return false;
    }

    this.checkObjectStatus = async function (domain, subdomain, gtin) {
        return await productFactory.checkObjectStatus(domain, subdomain, gtin, version);
    }

    this.recover = async function (domain, subdomain, gtin, req, res) {
        let auditId;
        const userId = req.headers["user-id"];
        let operationInProgressContext = {
            operation: OPERATIONS.PRODUCT_RECOVERY_IN_PROGRESS,
            gtin,
            userId
        }
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        let productVersion;
        try {
            productVersion = await recoveryUtils.runRecovery(version, gtin);
        } catch (err) {
            let auditContext = {
                operation: OPERATIONS.PRODUCT_RECOVERY_FAIL,
                gtin,
                userId
            }

            try {
                await auditService.auditFail(auditId, auditContext);
            } catch (err) {
                logger.error(err);
                res.send(500, "Failed to audit failed result of an operation");
                return;
            }
            res.send(424, err.message);
            return;
        }

        if (typeof productVersion !== "undefined") {
            let auditContext = {
                reason: `The product with GTIN ${gtin} got recovered as version ${productVersion}`,
                gtin,
                userId,
                newVersion: productVersion
            }

            try {
                await auditService.auditSuccess(auditId, auditContext);
            } catch (err) {
                logger.error(err);
                res.send(500, "Failed to audit success result of an operation");
                return;
            }
        } else {
            //if newVersion is undefined it means that we were able to load the latest version
            let auditContext = {
                operation: OPERATIONS.RECOVERED_PRODUCT,
                gtin,
                userId
            }

            try {
                await auditService.auditSuccess(auditId, auditContext);
            } catch (err) {
                logger.error(err);
                res.send(500, "Failed to audit result of an operation");
                return;
            }
        }

        res.send(200);
    }
}

let instances = {};

function getInstance(enclave, version) {
    if (!instances[version]) {
        instances[version] = new ProductController(enclave, version);
    }

    return instances[version];
}

module.exports = {
    getInstance
}
