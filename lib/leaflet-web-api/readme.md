# **Overview**

Leaflet-web-api is a webservice which can be used by web users in order to retrieve leaflets.

# **Credentials**

Request will not require any credentials but must contain a valid Blockchain domain (BDNS).

# **Request a complete leaflet**

Receive the XML of a leaflet based on a GTIN-code.

GET /leaflets/{domain}?{gtin}="gtin_value"&"{batch}"="batch_value"&{lang}="lang_value"&{leaflet_type}="smpc | leaflet"

PARAMETERS:

{gtin}: (**required**) The complete GTIN-code of the medicine.

{batch}: (**optional**) If batch identifier is provided and there is a batch specific leaflet/smpc it will be returned.
If batch id is provided and there is no batch specific leaflet/smpc result will be a leaflet/smpc of the product.

{lang}: (**required**) The language of the leaflet (possible values: en, fr,de ...).

{leaflet_type}: (**required**) Type of the leaflet (possible values: leaflet, smpc).

# **Result**

Result is a JSON that will contain 2 fields:

- resultStatus - a string for result with possible values xml_found | no_xml_for_lang
- xmlContent - a string with leaflet xml file content returned if resultStatus is "xml_found"
- productData - an object containing additional metadata about product and batch returned if resultStatus is "xml_found"
- leafletImages - an object containing base64 images of the leaflet (the key is the image name form leaflet)
- availableLanguages - an array of available leaflet languages will be returned in response only if resultStatus is "
  no_xml_for_lang"

# ** HTTP Result codes**

- 200 - an leaflet was found or there are available leaflets for other languages
- 400 - missing mandatory parameter form request
- 404 - no leaflet was found and no available leaflet for other languages
- 500 - a network error
  **Example:**

{
"
xmlContent":"<?xml version=\"1.0\" encoding=\"UTF-8\"?><?xml-stylesheet href=\"https://www.accessdata.fda.gov/spl/stylesheet/spl.xsl\" type=\"text/xsl\"?>
\n<document xmlns=\"urn:hl7-org:v3\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"urn:
hl7-org:v3 https://www.accessdata.fda.gov/spl/schema/spl.xsd\">\n   <id root=\"9a103985-33d4-4cee-ac42-f2e99876af74\"/>
\n   <code code=\"34391-3\" displayName=\"HUMAN PRESCRIPTION DRUG LABEL\" codeSystem=\"2.16.840.1.113883.6.1\"/>
\n   <title>\n      <content styleCode=\"bold\">These highlights do not include all the information needed to use
COSENTYX safely and effectively. See full prescribing information for COSENTYX.</content>\n      <br/>\n
....

"leafletImages":{"cosentyx-14.jpg":"data:image/png;base64,
/9j/4AAQSkZJRgABAgEAYABgAAD//gASTEVBRFRPT0xTIHYyMC4wAP/bAIQABQUFCAUIDAcHDAwJCQkMDQwMDAwNDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQEFCAgKBwoMBwcMDQwKDA0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N/
....
}
