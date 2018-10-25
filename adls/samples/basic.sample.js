// Steps to run this sample
// 1. npm install
// 2. Enter your storage account name and shared key in main()

const fs = require("fs");
const path = require("path");

const {
  Aborter,
  SharedKeyCredential,
  TokenCredential,
  ServiceURL,
  StorageURL,
  PathURL,
  Models,
  FileSystemURL,
  uploadLocalFile
} = require("..");

async function main() {
  // Enter your storage account name and shared key before running this sample
  const account = "";
  const accountKey = "";
  const localFilePath = "";

  // Use SharedKeyCredential with storage account and account key
  const sharedKeyCredential = new SharedKeyCredential(account, accountKey);

  const tokenCredential = new TokenCredential("oauthToken");

  // Use sharedKeyCredential or tokenCredential to create a pipeline
  const pipeline = StorageURL.newPipeline(sharedKeyCredential, {
    logger: {
      minimumLogLevel: 4,
      log: (logLevel, message) => {
        console.log(message);
      }
    },
    retryOptions: { maxTries: 5 }
  });

  const serviceURL = new ServiceURL(
    `https://${account}.dfs.core.windows.net`,
    pipeline
  );

  const fileSystemName = `fs${new Date().getTime()}`;
  const fileSystemURL = FileSystemURL.fromServiceURL(
    serviceURL,
    fileSystemName
  );

  // Create File System
  console.log(`# Create file system: ${fileSystemName}\n`);
  await fileSystemURL.create(Aborter.none);

  // Get File System Properties
  console.log(`# Get file system properties\n`);
  let properties = await fileSystemURL.getProperties(Aborter.none);
  console.log(`Properties: ${JSON.stringify(properties)}\n`);

  // Set File System Properties
  const fileSystemProperties = "h1=djE=,h3=djM=";
  console.log(`# Set file system properties: ${fileSystemProperties}\n`);
  await fileSystemURL.setProperties(Aborter.none, fileSystemProperties);

  console.log(`# Refresh file system properties\n`);
  properties = await fileSystemURL.getProperties(Aborter.none);
  console.log(`Properties: ${JSON.stringify(properties)}\n`);

  // List File Systems
  console.log(`# List all file systems\n`);
  let marker;
  do {
    const listFileSystemsResponse = await serviceURL.listFileSystemsSegment(
      Aborter.none
    );

    marker = listFileSystemsResponse.xMsContinuation;
    for (const fileSystem of listFileSystemsResponse.filesystems) {
      console.log(
        `=====> fileSystem: ${fileSystem.name} ${JSON.stringify(fileSystem)}`
      );

      const filesystemURL = FileSystemURL.fromServiceURL(
        serviceURL,
        fileSystem.name
      );

      const properties = await filesystemURL.getProperties(Aborter.none);
      console.log(`=====> properties: ${JSON.stringify(properties)}\n`);
    }
  } while (marker);

  // Create directory
  const directoryName = `mydirectory${new Date().getTime()}`;
  console.log(`# Create directory: ${directoryName}\n`);
  const directoryURL = PathURL.fromFileSystemURL(fileSystemURL, directoryName);

  await directoryURL.create(Aborter.none, Models.PathResourceType.Directory);

  // Rename directory
  const destDirectoryName = `destdirectory${new Date().getTime()}`;
  console.log(`# Rename directory ${directoryName} to ${destDirectoryName}\n`);
  const destDirectoryURL = PathURL.fromFileSystemURL(
    fileSystemURL,
    destDirectoryName
  );
  await destDirectoryURL.create(Aborter.none, {
    xMsRenameSource: `/${directoryURL.fileSystemName}/${directoryURL.path}`
  });

  // Set directory properties
  const dirProperties = "v1=MQ==";
  console.log(`# Set directory properties: ${dirProperties}\n`);
  const setPropertiesResponse = await destDirectoryURL.update(
    Aborter.none,
    Models.PathUpdateAction.SetProperties,
    { xMsProperties: dirProperties }
  );

  // Get directory properties
  console.log("# Get directory properties\n");
  const directoryPropertiesResponse = await destDirectoryURL.getProperties(
    Aborter.none
  );
  console.log(
    `Directory Properties: ${JSON.stringify(directoryPropertiesResponse)}\n`
  );

  // Create file
  const fileName = `${destDirectoryURL.path}/file${new Date().getTime()}`;
  const fileURL = PathURL.fromFileSystemURL(fileSystemURL, fileName);

  console.log(`# Create file: ${fileName}\n`);
  await fileURL.create(Aborter.none, Models.PathResourceType.File);

  // Update file content and commit file
  console.log("# Append file content and flush\n");
  const content = "Hello World";
  await fileURL.update(Aborter.none, Models.PathUpdateAction.Append, {
    position: 0,
    requestBody: content,
    contentLength: content.length.toString()
  });

  await fileURL.update(Aborter.none, Models.PathUpdateAction.Flush, {
    position: content.length
  });

  // Download & read file
  console.log("# Download & Read file\n");
  const readResponse = await fileURL.read(Aborter.none);
  console.log(
    `Content read: ${readResponse.readableStreamBody
      .read(content.length)
      .toString()}\n`
  );

  const rs = readResponse.readableStreamBody;
  rs.on("data", console.log);
  rs.on("error", console.error);
  rs.on("end", () => {
    console.log("end");
  });

  // Upload local file parallel (highlevel API, STILL UNDER DEVELOPMENT)
  const localFileName = path.basename(localFilePath);
  const fullPath = `${destDirectoryName}/${localFileName}`;
  const fileURL2 = PathURL.fromFileSystemURL(fileSystemURL, fullPath);
  console.log(`# Upload local file: ${localFilePath} to ${fileURL2.url}`);
  await fileURL2.create(Aborter.none, Models.PathResourceType.File);
  await uploadLocalFile(Aborter.none, localFilePath, fileURL2, {
    blockSize: 4 * 1024 * 1024,
    parallelism: 100,
    progress: console.log
  });

  // Download uploaded local file to disk
  console.log(`\n # Download uploaded local file to disk`);
  // const fileURL2 = new PathURL(
  //   "https://adlsxiaonli.dfs.core.windows.net/fs1540362248858/destdirectory1540362250686/DeanBrown2014KaskaskiaMss_1.0_16feb2014_S.pdf",
  //   pipeline
  // );

  const downloadResponse = await fileURL2.read(Aborter.timeout(5 * 1000), {
    progress: console.log
  });

  await (async () => {
    return new Promise((resolve, reject) => {
      if (!downloadResponse.readableStreamBody) {
        reject("Download stream is empty");
      }
      downloadResponse.readableStreamBody.on("error", reject);
      downloadResponse.readableStreamBody.on("end", resolve);

      // let localFileName = "downloaded.pdf";
      if (fs.existsSync(localFileName)) {
        fs.unlinkSync(localFileName);
      }
      const ws = fs.createWriteStream(localFileName);
      downloadResponse.readableStreamBody.pipe(ws);
    });
  })();

  // List paths
  // console.log("# List paths\n");
  // const listPathsResult = await fileSystemURL.listPathsSegment(
  //   Aborter.none,
  //   true
  // );
  // for (const path of listPathsResult.paths) {
  //   console.log(`Path: ${path.name} ${JSON.stringify(path)}\n`);
  // }

  // Delete directory
  console.log("# Delete directory\n");
  await destDirectoryURL.delete(Aborter.none, { recursive: true });

  // Delete File System
  console.log("# Delete filesystem\n");
  await fileSystemURL.delete();
}

// An async method returns a Promise object, which is compatible with then().catch() coding style.
main()
  .then(() => {
    console.log("Successfully executed sample.");
  })
  .catch(err => {
    console.error(err);
  });
