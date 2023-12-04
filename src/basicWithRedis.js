/**
 * Purpose: Search Amazon for a list of products and scrape product details.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const wait = require('wait');
const Redis = require('ioredis');

const API_KEY = ''; // Your API key here.
const MAX_CONCURRENCY = 5;
const REDIS_URL = ''; // Your Redis URL here.

let currentRequests = 0;

const redis = new Redis(REDIS_URL);

/**
 * Async function to wait for an available concurrency slot.  As we store
 * the number of current requests in redis, this will work across multiple
 * instances of the scraper.
 */
const waitForSlot = async(requestId) => {
  // We use a list in redis with expiring entires - one entry for each request being processed.
  // This avoids race conditions and naturally cleans itself up if we have a crash.
  let currentRequests = await redis.llen('currentRequests');
  while (currentRequests >= MAX_CONCURRENCY) {
    await wait(200);
    currentRequests = await redis.llen('currentRequests');
  }
  redis.multi().rpush('currentRequests', requestId).expire('currentRequests', 70).exec();
}

const removeSlot = async(requestId) => {
  redis.lrem('currentRequests', 1, requestId);
}

const getRequestId = () => {
  return Math.random().toString(36).substring(7);
}

/**
 * Given an asin, this function will scrape the product details, offers and reviews from Amazon.
 * @param {string} asin 
 */
const getProduct = async(asin) => {
  let retries = 0;
  let productDetails;
  let requestId;

  while (retries < 5) {
    retries += 1;
    try {
      // Make sure we don't exceed our account's concurrency limit.
      requestId = getRequestId();
      await waitForSlot(requestId);
      while (currentRequests >= MAX_CONCURRENCY) {
        await wait(200);
      }
      currentRequests += 1;
      productDetails = await axios.get(`https://api.scraperapi.com/?api_key=${API_KEY}&url=https://www.amazon.com/dp/${asin}`);
      break;
    } catch (err) {
      console.error(err);
    } finally {
      removeSlot(requestId);
    }
  }

  if (retries === 5) {
    throw new Error(`Failed to fetch from Amazon for ${asin}`);
  }

  // Load the product details raw HTML into Cheerio and extract the product details.
  let $$ = cheerio.load(productDetails.data, { _useHtmlParser2: true });
  const product = {
    details: { asin },
    offers: [],
    reviews: []
  };
  product.details.description = $$('div#productDescription').text();
  product.details.dimensions = $$('div#detail-bullets').find('li:contains("Product Dimensions")').text();
  product.details.weight = $$('div#detail-bullets').find('li:contains("Item Weight")').text();
  product.details.bestSellersRank = $$('div#detail-bullets').find('li:contains("Best Sellers Rank")').text();
  product.details.manufacturer = $$('div#detail-bullets').find('li:contains("Manufacturer")').text();

  // Scrape product offers from Amazon.
  retries = 0;
  let offers;
  while (retries < 5) {
    retries += 1;
    // Make sure we don't exceed our account's concurrency limit.
    requestId = getRequestId();
    await waitForSlot(requestId);
    try {
      currentRequests += 1;
      const url = `https://www.amazon.com/gp/offer-listing/${asin}/ref=dp_olp_ALL_mbc?ie=UTF8&condition=ALL`
      offers = await axios.get(`https://api.scraperapi.com/?api_key=${API_KEY}&url=${encodeURIComponent(url)}`);
      break;
    } catch (err) {
      if (err.response?.status === 404) {
        // No offers found.
        break;
      }
      console.error(err);
    } finally {
      removeSlot(requestId);
    }
  }

  if (retries === 5) {
    throw new Error(`Failed to fetch from Amazon Offers for ${asin}`);
  }

  if (offers?.data) {
    $$ = cheerio.load(offers.data, { _useHtmlParser2: true }); 
    // ...
  }

  // Scrape product reviews from Amazon.
  // ...

  return product;
}

(async() => {

  // Scrape "Air Fryer" search results from Amazon, retrying up to 5 times in the unlikely event of failure.
  let retries = 0;
  let searchResults;
  const asins = [];
  const products = [];

  while (retries < 5) {
    retries += 1;
    try {
      searchResults = await axios.get(`https://api.scraperapi.com/?api_key=${API_KEY}&url=https://www.amazon.com/s?k=Air+Fryer`);
      break;
    } catch (err) {
      console.error(err);
    }
  }

  if (retries === 5) {
    console.error('Failed to fetch from Amazon');
    return;
  }

  try {
    // Load the search results raw HTML into Cheerio and extract the product details.  This is an
    // extremely simplified example and does not, for example, handle pagination or product detail.
    const $ = cheerio.load(searchResults.data, { _useHtmlParser2: true }); // eslint-disable-line id-length
    $('div[data-asin]').each((index, element) => {
      if ($(element).attr('data-asin') !== '') {
        asins.push($(element).attr('data-asin'));
      }
    });
  } catch (err) {
    console.error(err);
    return;
  }

  // Now we have the products we searched for, we can scrape each individual product page for more details.
  const promises = [];
  asins.forEach(async(asin) => {
    promises.push(new Promise((resolve, reject) => getProduct(asin)
      .then(product => {
        products.push(product);
        return resolve();
      }).catch(err => {
        return reject(err)
      })
    ));
  });

  await Promise.all(promises);
  redis.quit();

  // Save scraped data to the database.

  console.log('Done!');
}) ();
