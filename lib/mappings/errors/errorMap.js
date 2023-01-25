module.exports = {
  PRODUCT_DSU_LOAD_FAIL: {errCode: 7, errMsg: "Failed to load product DSU"},
  BATCH_MISSING_PRODUCT: {errCode: 8, errMsg: "Fail to create a batch for a missing product"},
  BATCH_DSU_LOAD_FAIL: {errCode: 9, errMsg: "Failed to load batch DSU"},
  PHOTO_MISSING_PRODUCT: {errCode: 10, errMsg: "Fail to create a product photo for a missing product"},
  VIDEO_SOURCE_MISSING_PRODUCT: {errCode: 11, errMsg: "Fail to add video source for missing batch or missing product"},
  GTIN_VALIDATION_FAIL: {errCode: 12, errMsg: "Failed to validate gtin"},
  DSU_MOUNT_FAIL: {errCode: 13, errMsg: "Failed to mount in DSU"},
  UNSUPPORTED_FILE_FORMAT: {errCode: 14, errMsg: "Upload of unsupported file format"},
  TOKEN_VALIDATION_FAIL: {errCode: 15, errMsg: "Invalid or missing token"},
  WRITING_FILE_FAILED: {errCode: 16, errMsg: "Failed to write file into DSU"},
  FILE_CONTAINS_FORBIDDEN_TAGS: {errCode: 17, errMsg: "File contains forbidden html tags"},
  EXISTING_BATCH_ID: {errCode: 19, errMsg: "Fail to create a batch. Batch number is already used for other product"},
  MVP1_RESTRICTED: {errCode: 20, errMsg: "Message is MVP1 restricted."},
  NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER: {errCode: 40, errMsg: "Not able to ensure data consistency on server."}
}
