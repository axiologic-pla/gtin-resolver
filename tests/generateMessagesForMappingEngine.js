function generateGTIN() {
    const gtinMultiplicationArray = [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3];

    let gtinDigits = [];
    for (let i = 0; i < 13; i++) {
        gtinDigits.push(Math.floor(Math.random() * 10))
    }
    let j = gtinMultiplicationArray.length - 1;
    let reszultSum = 0;
    for (let i = gtinDigits.length - 1; i >= 0; i--) {
        reszultSum = reszultSum + gtinDigits[i] * gtinMultiplicationArray[j];
        j--;
    }
    let validDigit = Math.floor((reszultSum + 10) / 10) * 10 - reszultSum;
    if (validDigit === 10) {
        validDigit = 0;
    }

    gtinDigits.push(validDigit);

    return gtinDigits.join('');
}

const message = {
    "messageType": "Product",
    "messageTypeVersion": 1,
    "senderId": "devuser",
    "receiverId": "",
    "messageId": "5280565978993",
    "messageDateTime": "2022-10-04T08:42:22.826Z",
    "token": "",
    "product": {
        "inventedName": "test",
        "productCode": "00000001231113",
        "nameMedicinalProduct": "asdasd",
        "manufName": "",
        "adverseEventReportingURL": "http://localhost:8080/borest/scan",
        "acfProductCheckURL": "http://localhost:8080/borest/scan",
        "flagEnableAdverseEventReporting": false,
        "flagEnableACFProductCheck": false,
        "healthcarePractitionerInfo": "SmPC",
        "patientSpecificLeaflet": "Patient Information",
        "markets": [],
        "internalMaterialCode": "",
        "strength": ""
    }
}

const NO_MESSAGES = 1000;
const messages = [];
for (let i = 0; i < NO_MESSAGES; i++) {
    const msg = JSON.parse(JSON.stringify(message));
    msg.product.productCode = generateGTIN();
    messages.push(msg);
}

require("fs").writeFileSync("messages.json", JSON.stringify(messages));