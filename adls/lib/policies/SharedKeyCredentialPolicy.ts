import { RequestPolicy, RequestPolicyOptions, WebResource } from "ms-rest-js";
import { SharedKeyCredential } from "../credentials/SharedKeyCredential";
import { HeaderConstants } from "../utils/constants";
import {
  getURLPath,
  getURLPathComponents,
  getURLQueries,
  setURLPath
} from "../utils/utils.common";
import { CredentialPolicy } from "./CredentialPolicy";

/**
 * SharedKeyCredentialPolicy is a policy used to sign HTTP request with a shared key.
 *
 * @export
 * @class SharedKeyCredentialPolicy
 * @extends {CredentialPolicy}
 */
export class SharedKeyCredentialPolicy extends CredentialPolicy {
  /**
   * Reference to SharedKeyCredential which generates SharedKeyCredentialPolicy
   *
   * @type {SharedKeyCredential}
   * @memberof SharedKeyCredentialPolicy
   */
  private readonly factory: SharedKeyCredential;

  /**
   * Creates an instance of SharedKeyCredentialPolicy.
   * @param {RequestPolicy} nextPolicy
   * @param {RequestPolicyOptions} options
   * @param {SharedKeyCredential} factory
   * @memberof SharedKeyCredentialPolicy
   */
  constructor(
    nextPolicy: RequestPolicy,
    options: RequestPolicyOptions,
    factory: SharedKeyCredential
  ) {
    super(nextPolicy, options);
    this.factory = factory;
  }

  /**
   * Signs request.
   *
   * @protected
   * @param {WebResource} request
   * @returns {WebResource}
   * @memberof SharedKeyCredentialPolicy
   */
  protected signRequest(request: WebResource): WebResource {
    // By default, dfs swagger and autorest auto generated code will call encodeURIcomponent to encode the path
    // however, double URI encoding will lead to 403 auth error ( "/" -> "%2F" => "%252F", "$" -> "%24" -> "%2524")
    // One solution is to add ""x-ms-skip-url-encoding": true" to the "path" parameter in the swagger
    // Following workaround is to decode first before encode to avoid the double URI encode issue
    const urlPathComponents = getURLPathComponents(request.url);
    if (urlPathComponents.length > 0) {
      const decodedPath = [
        decodeURIComponent(urlPathComponents[0]),
        decodeURIComponent(urlPathComponents.slice(1).join("/"))
      ]
        .filter(word => word.length > 0)
        .join("/");
      request.url = setURLPath(request.url, decodedPath);
    }

    request.headers.set(HeaderConstants.X_MS_DATE, new Date().toUTCString());

    if (
      request.body &&
      typeof request.body === "string" &&
      request.body.length > 0
    ) {
      request.headers.set(HeaderConstants.CONTENT_LENGTH, request.body.length);
    }

    const stringToSign: string =
      [
        request.method.toUpperCase(),
        this.getHeaderValueToSign(request, HeaderConstants.CONTENT_LANGUAGE),
        this.getHeaderValueToSign(request, HeaderConstants.CONTENT_ENCODING),
        this.getHeaderValueToSign(request, HeaderConstants.CONTENT_LENGTH),
        this.getHeaderValueToSign(request, HeaderConstants.CONTENT_MD5),
        this.getHeaderValueToSign(request, HeaderConstants.CONTENT_TYPE),
        this.getHeaderValueToSign(request, HeaderConstants.DATE),
        this.getHeaderValueToSign(request, HeaderConstants.IF_MODIFIED_SINCE),
        this.getHeaderValueToSign(request, HeaderConstants.IF_MATCH),
        this.getHeaderValueToSign(request, HeaderConstants.IF_NONE_MATCH),
        this.getHeaderValueToSign(request, HeaderConstants.IF_UNMODIFIED_SINCE),
        this.getHeaderValueToSign(request, HeaderConstants.RANGE)
      ].join("\n") +
      "\n" +
      this.getCanonicalizedHeadersString(request) +
      this.getCanonicalizedResourceString(request);

    const signature: string = this.factory.computeHMACSHA256(stringToSign);
    request.headers.set(
      HeaderConstants.AUTHORIZATION,
      `SharedKey ${this.factory.accountName}:${signature}`
    );

    // console.log(`[URL]:${request.url}`);
    // console.log(`[HEADERS]:${request.headers.toString()}`);
    // console.log(`[STRING TO SIGN]:${JSON.stringify(stringToSign)}`);
    // console.log(`[KEY]: ${request.headers.get(HeaderConstants.AUTHORIZATION)}`);
    return request;
  }

  /**
   * Retrieve header value according to shared key sign rules.
   * @see https://docs.microsoft.com/en-us/rest/api/storageservices/authenticate-with-shared-key
   *
   * @private
   * @param {WebResource} request
   * @param {string} headerName
   * @returns {string}
   * @memberof SharedKeyCredentialPolicy
   */
  private getHeaderValueToSign(
    request: WebResource,
    headerName: string
  ): string {
    const value = request.headers.get(headerName);

    if (!value) {
      return "";
    }

    // When using version 2015-02-21 or later, if Content-Length is zero, then
    // set the Content-Length part of the StringToSign to an empty string.
    // https://docs.microsoft.com/en-us/rest/api/storageservices/authenticate-with-shared-key
    if (headerName === HeaderConstants.CONTENT_LENGTH && value === "0") {
      return "";
    }

    return value;
  }

  /**
   * To construct the CanonicalizedHeaders portion of the signature string, follow these steps:
   * 1. Retrieve all headers for the resource that begin with x-ms-, including the x-ms-date header.
   * 2. Convert each HTTP header name to lowercase.
   * 3. Sort the headers lexicographically by header name, in ascending order.
   *    Each header may appear only once in the string.
   * 4. Replace any linear whitespace in the header value with a single space.
   * 5. Trim any whitespace around the colon in the header.
   * 6. Finally, append a new-line character to each canonicalized header in the resulting list.
   *    Construct the CanonicalizedHeaders string by concatenating all headers in this list into a single string.
   *
   * @private
   * @param {WebResource} request
   * @returns {string}
   * @memberof SharedKeyCredentialPolicy
   */
  private getCanonicalizedHeadersString(request: WebResource): string {
    let headersArray = request.headers.headersArray().filter(value => {
      return value.name
        .toLowerCase()
        .startsWith(HeaderConstants.PREFIX_FOR_STORAGE);
    });

    headersArray.sort(
      (a, b): number => {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
    );

    // Remove duplicate headers
    headersArray = headersArray.filter((value, index, array) => {
      if (
        index > 0 &&
        value.name.toLowerCase() === array[index - 1].name.toLowerCase()
      ) {
        return false;
      }
      return true;
    });

    let canonicalizedHeadersStringToSign: string = "";
    headersArray.forEach(header => {
      canonicalizedHeadersStringToSign += `${header.name
        .toLowerCase()
        .trimRight()}:${header.value.trimLeft()}\n`;
    });

    return canonicalizedHeadersStringToSign;
  }

  /**
   * Retrieves the webResource canonicalized resource string.
   *
   * @private
   * @param {WebResource} request
   * @returns {string}
   * @memberof SharedKeyCredentialPolicy
   */
  private getCanonicalizedResourceString(request: WebResource): string {
    // console.log(
    //   `[getCanonicalizedResourceString(), urlPathBeforeEncode]: ${getURLPath(
    //     request.url
    //   )}`
    // );
    const path = encodeURI(getURLPath(request.url) || "/");
    // console.log(
    //   `[getCanonicalizedResourceString(), urlPathafterEncode]: ${path}`
    // );

    let canonicalizedResourceString: string = "";
    canonicalizedResourceString += `/${this.factory.accountName}${path}`;

    const queries = getURLQueries(request.url);
    if (getURLQueries(request.url)) {
      const queryKeys: string[] = [];
      for (const key in queries) {
        if (queries.hasOwnProperty(key)) {
          queryKeys.push(key);
        }
      }

      queryKeys.sort();
      for (const key of queryKeys) {
        canonicalizedResourceString += `\n${key}:${decodeURIComponent(
          queries[key]
        )}`;
      }
    }

    return canonicalizedResourceString.toLowerCase();
  }
}
