const messageHeaderSchema = require("./../messageHeaderSchema");
let videoSchema = {
    "type": "object",
    "properties":
        {
            "videos": {
                "type": "object", "required": true,
                "properties": {
                    "productCode": {"type": "string", "required": true},
                    "source": {"type": "string", "required": false},
                    "batch": {"type": "string", "required": false},
                    "sources": {
                        "type": "array", "required": false,
                        "items": {
                            "type": "object",
                            "properties": {
                                "documentType": {"type": "string"},
                                "lang": {"type": "string"},
                                "source": {"type": "string"}
                            }
                        }
                    }
                }
            }
        }
}
videoSchema.properties = {...messageHeaderSchema, ...videoSchema.properties}
module.exports = videoSchema
