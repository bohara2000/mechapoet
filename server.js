if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const app = express();
app.use(express.json()); // support json encoded bodies
app.use(express.urlencoded({ extended: true })); // support encoded bodies

var port = process.env.port || 8080;
var fs = require('fs'),
  poemGen = require('poem-gen'),
  path = require('path'),
  util = require('util'),
  textToPng = require('text2png'),
  twitconfig = require('./config/config'),
  schemelist = require('./config/customschemes.json'),
  mushrooms = require('./config/mushrooms.json'),
  colorpalette = require('./config/colorcombos.json'),
  Twit = require('twit'),
  needle = require('needle'),
  azure = require('azure-storage',)
postImage = require('post-image-to-twitter');

const Grammarbot = require('grammarbot');
const { BlobServiceClient } = require('@azure/storage-blob');
const { BlobService } = require('azure-storage');
const { time } = require('console');
const { resolve } = require('path');


// Retrieve the connection string for use with the application. The storage
// connection string is stored in an environment variable on the machine
// running the application called AZURE_STORAGE_CONNECTION_STRING. If the
// environment variable is created after the application is launched in a
// console or with Visual Studio, the shell or application needs to be closed
// and reloaded to take the environment variable into account.
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

var args = {};

//args.words = process.env.words;
args.file = `./config/${process.env.CORPORA_FILE}`; // all corpora files must exist in the config folder
args.repeats = process.env.repeats;
args.scheme = schemelist.type[1];

if (process.env.verbose) {
  args.verbose = true;
}

if (process.env.seedfile) {
  args.file = process.env.seedfile;
}

if (process.env.scheme) {
  args.scheme = process.env.scheme;
}

const bot = new Grammarbot({
  'api_key': process.env.GRAMMARBOT_KEY,      // (Optional) defaults to node_default
  'language': 'en-US',         // (Optional) defaults to en-US
  'base_uri': 'api.grammarbot.io', // (Optional) defaults to api.grammarbot.io
});

// Create the BlobServiceClient object which will be used to create a container client
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
var blobService = azure.createBlobService(AZURE_STORAGE_CONNECTION_STRING);

// Create a TableService object which will be used to create and query a table
const tableService = azure.createTableService(AZURE_STORAGE_CONNECTION_STRING);


// Create a unique name for the container
const containerName = process.env.containername;

// Get a reference to a container
const containerClient = blobServiceClient.getContainerClient(containerName);


// create a unique name for the table
const tableName = process.env.tablename;

// Create the table if it doesn't exist
tableService.createTableIfNotExists(tableName, function (error, result, response) {
  if (!error) {
    // Table exists or created
    console.log(`Created Azure Table:\n${tableName}`);
  }
  else {
    console.log(`Error on creating table:\n${error}`);
  }
});



// We're going to try retrieving tweets from a Twitter account that displays images for
// writing prompts. Currently using MajesticPrompts 
var userId = `${process.env.TWITTER_PROMPT_TWEETID}`
var poemgenfilename = ''
var found = false
const getTweetUrl = `https://api.twitter.com/2/users/${userId}/tweets`;
const bearerToken = twitconfig.bearer_token;

// we request the author_id expansion so that we can print out the user name later
var params = {
  "max_results": 10,
  "tweet.fields": "id,created_at,public_metrics,source",
  "expansions": "author_id"
}

const formatDate = () => {
  let currentDate = new Date();
  return `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
}

const options = {
  headers: {
    "User-Agent": "v2UserTweetsJS",
    "Authorization": `Bearer ${bearerToken}`
  }
}

function wrapUp(error, data) {
  if (error) {
    console.log(error, error.stack);

    if (data) {
      console.log('data:', data);
    }
  }
}

function uploadPoemToBlobStorage(blobName, data) {
  // Get a block blob client
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  console.log('\nUploading to Azure storage as blob:\n\t', blobName);

  // Upload data to the blob
  const uploadBlobResponse = blockBlobClient.upload(data, data.length);
  console.log("Blob was uploaded successfully. requestId: ", uploadBlobResponse.requestId);

}

//List all blobs within a blob container
const listBlobs = async (containername, blobName) => {
  return new Promise((resolve, reject) => {
    blobService.listBlobsSegmentedWithPrefix(containerName, blobName.substring(0, 15), null, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve({ message: `${data.entries.length} blobs in '${containername}'`, blobs: data.entries });
      }
    });
  });
};

//Download blob
const downloadBlob = async (containerName, blobName) => {
  return new Promise((resolve, reject) => {
    blobService.getBlobToText(containerName, blobName, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve({ message: `Blob downloaded "${data}"`, name: blobName, text: data });
      }
    });
  });
};


var Text2PngPromise = function (output) {
  return new Promise(function (resolve, reject) {
    try {
      console.log(output);

      var result = textToPng(output, {
        bgColor: colorpalette.combos[new Date().getDay()].bgColor,
        color: colorpalette.combos[new Date().getDay()].fgColor,
        padding: 20,
        font: '24px OFLGoudyStMTT',
        localFontPath: 'fonts/OFLGoudyStMTT.ttf',
        localFontName: 'OFLGoudyStMTT',
        output: 'dataURL'
      });

      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
};

var getTweets = function (opts) {
  return new Promise((resolve, reject) => {
    var T = new Twit(twitconfig);

    T.get('search/tweets', opts, function (err, data) {
      if (err) {
        return reject(err);
      }

      resolve(data);
    });
  });
};

var autocorrect = function (text, json) {
  let new_text = '';
  let cursor = 0;
  // console.log(json);  

  json.matches.forEach(match => {
    let offset = match.offset;
    let length = match.length;

    if (cursor > offset) {
      return;
    }
    // build new_text from cursor to current offset
    new_text += text.substring(cursor, offset);

    // next add first replacement
    let repls = match.replacements;
    if (repls && repls.length > 0) {
      new_text += repls[0].value;
    }

    // update cursor
    cursor = offset + length;
  });

  // if cursor < text length, then add remaining text to new_text

  if (cursor < text.length) {
    new_text += text.substring(cursor);
  }

  return new_text;
}

async function getRequest(tweet_id, endpointurl, opts) {



  // this is the HTTP header that adds bearer token authentication
  const res = await needle('get', endpointurl, opts, {
    headers: {
      "User-Agent": "v2TweetLookupJS",
      "authorization": `Bearer ${bearerToken}`
    }
  })

  if (res.body) {
    return res.body;
  } else {
    throw new Error('Unsuccessful request');
  }
}

const getUserTweets = async (params) => {
  let userTweets = [];

  let hasNextPage = true;
  let nextToken = null;
  let userName;
  console.log("Retrieving Tweets...");

  while (hasNextPage) {
    let resp = await getPage(params, options, nextToken);
    if (resp && resp.meta && resp.meta.result_count && resp.meta.result_count > 0) {
      userName = resp.includes.users[0].username;
      if (resp.data) {
        userTweets.push.apply(userTweets, resp.data);
      }
      if (resp.meta.next_token && userTweets.length < params.max_results) {
        nextToken = resp.meta.next_token;
      } else {
        hasNextPage = false;
      }
    } else {
      hasNextPage = false;
    }
  }

  // console.dir(userTweets, {
  //     depth: null
  // });
  // console.log(`Got ${userTweets.length} Tweets from ${userName} (user ID ${userId})!`);

  return {
    "userName": userName,
    "tweets": userTweets
  };
}

const getPage = async (params, options, nextToken) => {
  if (nextToken) {
    params.pagination_token = nextToken;
  }

  try {
    const resp = await needle('get', getTweetUrl, params, options);

    if (resp.statusCode != 200) {
      console.log(resp);
      console.log(`status code not OK: ${resp.toString()}`);
      return;
    }
    return resp.body;
  } catch (err) {
    throw new Error(`Request failed: ${err}`);
  }
}


const getSuggestedGrammar = async (text) => {
  return new Promise((resolve, reject) => {
    bot.check(text, function (error, result) {
      if (error) {
        return reject(error);
      }

      return resolve(result);
    });
  });
};

var activeEntity = {}

app.set('view engine', 'pug')
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index')
})

app.get('/dailyprompt', (req, res) => {
  var prompt = '';

  getUserTweets(params)
    .then(data => {

      console.log(`Got ${data.tweets.length} Tweets from ${data.userName} (user ID ${userId})!`);
      // console.log(data.tweets[0])
      return data.tweets[0];
    })
    .then(latesttweet => {
      // console.log(latesttweet);

      // These are the parameters for the API request
      // specify Tweet IDs to fetch, and any additional fields that are required
      // by default, only the Tweet ID and text are returned
      const params = {
        "expansions": "attachments.media_keys",
        "user.fields": "created_at", // Edit optional query parameters here
        "media.fields": "url,preview_image_url"
      }

      return getRequest(latesttweet.id, `https://api.twitter.com/2/tweets/${latesttweet.id}`, params);

    })
    .then(result => {
      console.log(`returning ${result.includes.media[0].url}`);
      return res.json({ prompt_url: result.includes.media[0].url });
    })
    .catch(err => {
      console.log(`url: ${getTweetUrl}`)
      console.log('Error happened:', err)
      return res.json(err);
    });



})

app.get('/napowrimo/:datesought?', (req, res) => {
  var mechapoetparams = {
    q: `from:${process.env.TWITTER_POET_ACCOUNT}`,
    count: 30,
    result_type: 'all',
    lang: 'en'
  }

  if (activeEntity.RowKey) {
    console.log('activeEntity has a value, so clearing it.');
    activeEntity = {};
  }

  let dateSought = formatDate();
  console.log(`params: ${req.params.datesought}`);
  if (req.params.datesought) {
    dateSought = req.params.datesought;
  }

  console.log(`date sought: ${dateSought}`);

  getTweets(mechapoetparams)
    .then(data => {
      var retweetedOrLiked = data.statuses.filter(el => el.retweet_count > 0 || el.favorite_count > 0)
      var mostRecent = data.statuses[0]
      for (let i = 0; i < retweetedOrLiked.length; i++) {
        // Get the tweet Id from the returned data
        let id = { id: retweetedOrLiked[i].id_str }

        // console.log(retweetedOrLiked[i])
        console.log('Found: ',
          `${retweetedOrLiked[i].text}\n`,
          // `${retweetedOrLiked[i].metadata}\n`,
          `Created at ${retweetedOrLiked[i].created_at}\n`,
          `${retweetedOrLiked[i].retweet_count} retweets, ${retweetedOrLiked[i].favorite_count} likes\n`,
          `(https://twitter.com/${retweetedOrLiked[i].user.screen_name}/status/${id.id})`)

      }
      console.log('Most recent: ',
        `${mostRecent.text}\n`,
        `Created at ${mostRecent.created_at}\n`,
        `${mostRecent.retweet_count} retweets, ${mostRecent.favorite_count} likes\n`,
        `(https://twitter.com/${mostRecent.user.screen_name}/status/${mostRecent.id_str})`)

      let result = { retweetedOrLikedTweets: retweetedOrLiked, mostRecentTweet: mostRecent }
      let retweetIdList = result.retweetedOrLikedTweets.map(item => { return item['id_str']; })
      console.log(retweetIdList);

      // TODO: find a way to query Azure table to find the next available tweet
      let poemdatequery = new azure.TableQuery()
        .where('PartitionKey eq ?', 'napowrimo');
      // .and(`RowKey eq ?`, (new Date()).toISOString().split('T')[0]);

      var nextContinuationToken = null;
      poemgenfilename = `poem.gen.${mostRecent.text.match(/poem\s(\d+)\s#algo/)[1]}-0.txt`;

      tableService.queryEntities(tableName,
        poemdatequery,
        nextContinuationToken,
        function (error, results) {
          if (error) return reject(error);
          found = false;
          for (let index = 0; index < results.entries.length; index++) {
            const element = results.entries[index];
            // if (results.entries.length > 0) {
            //   console.log(results.entries[0].PoemGenFile._);
            //   activeEntity = results.entries[0];
            //   poemgenfilename = activeEntity.PoemGenFile._
            // }
            console.log(`Rowkey: ${element.RowKey._}`)
            if (results.entries[index].RowKey._ == dateSought) {
              console.log(`Poem found: ${results.entries[index].PoemGenFile._}`);
              activeEntity = results.entries[index];
              poemgenfilename = results.entries[index].PoemGenFile._;
              found = true;
              // return {
              //   filename: activeEntity.PoemGenFile._,
              //   tweetUsed: mostRecent
              // };
              return downloadBlob(containerName, activeEntity.PoemGenFile._)
                .then(promptinfo => {
                  downloadBlob(containerName, activeEntity.NewPoemFile._)
                    .then(result => {
                      return res.render('napowrimo', {
                        message: `NaPoWriMo for the day: ${activeEntity.RowKey._}`,
                        poem: promptinfo.text,
                        date: dateSought,
                        prompt_url: activeEntity.PromptUrl._,
                        tweet_id: activeEntity.TweetID._,
                        corrected_poem: result.text
                      })
                    })
                })
            }
          }

          console.log(`found is ${found}`)
          if (found == false) {
            return listBlobs(containerName, poemgenfilename)
              .then(bloblist => {
                console.log(bloblist);
                return downloadBlob(containerName, bloblist.blobs[0].name);
              })
              .then(promptinfo => {
                console.log(`prompt info:\n ${promptinfo.message}`);
                console.log(activeEntity);
                if (activeEntity.PromptUrl && activeEntity.NewPoemFile._) {
                  return downloadBlob(containerName, activeEntity.NewPoemFile._)
                    .then(result => {
                      res.render('napowrimo', {
                        message: `NaPoWriMo for the day: ${activeEntity.RowKey._}`,
                        poem: promptinfo.text,
                        date: dateSought,
                        prompt_url: activeEntity.PromptUrl._,
                        tweet_id: activeEntity.TweetID._,
                        corrected_poem: result.text
                      })
                    })

                } else {
                  // find today's latest prompt from Twitter prompt
                  getUserTweets(params)
                    .then(data => {

                      console.log(`Got ${data.tweets.length} Tweets from ${data.userName} (user ID ${userId})!`);
                      console.log(data.tweets);
                      return data.tweets.filter(d => d.created_at.indexOf(dateSought) > -1)[0];
                    })
                    .then(latesttweet => {
                      // console.log(latesttweet);

                      // These are the parameters for the API request
                      // specify Tweet IDs to fetch, and any additional fields that are required
                      // by default, only the Tweet ID and text are returned
                      let mediaparams = {
                        "expansions": "attachments.media_keys",
                        "user.fields": "created_at", // Edit optional query parameters here
                        "media.fields": "url,preview_image_url"
                      }

                      return getRequest(latesttweet.id, `https://api.twitter.com/2/tweets/${latesttweet.id}`, mediaparams);

                    })
                    .then(mediaresult => {
                      console.log(`returning ${mediaresult.includes.media[0].url}`);
                      // return res.json({ prompt_url: result.includes.media[0].url });
                      getSuggestedGrammar(promptinfo.text)
                        .then(grammaresult => {
                          // console.log(result);  
                          console.log("\n=====================================\n")

                          let corrected_text = autocorrect(promptinfo.text, grammaresult)
                          console.log(promptinfo.text);
                          console.log("\n=====================================\n")
                          console.log(corrected_text);

                          // create a file for the corrected text
                          let newpoemfilename = `napowrimo.${dateSought}.txt`
                          uploadPoemToBlobStorage(newpoemfilename, corrected_text);

                          // create/replace a new entity
                          console.log(mostRecent);

                          activeEntity = {
                            PartitionKey: { '_': 'napowrimo' },
                            RowKey: { '_': dateSought },
                            PoemGenFile: { '_': promptinfo.name },
                            PromptUrl: mediaresult.includes.media[0].url,
                            NewPoemFile: newpoemfilename,
                            TweetID: mostRecent.id_str
                          };

                          tableService.insertOrReplaceEntity(tableName, activeEntity, function (error, result, response) {
                            if (!error) {
                              // Entity updated
                              console.log('activeEntity created');
                              // render the page
                              res.render('napowrimo', {
                                message: `NaPoWriMo for the day: ${dateSought}`,
                                date: dateSought,
                                poem: promptinfo.text,
                                prompt_url: mediaresult.includes.media[0].url,
                                corrected_poem: corrected_text,
                                tweet_id: activeEntity.TweetID,
                              })
                            }
                            else {
                              throw new Error(error);
                            }
                          });


                        })
                    })
                }

              });

          }

        });

      return {
        filename: poemgenfilename,
        tweetUsed: mostRecent,
        found: found
      };
    })
    // .then(searchdata => {
    //   console.log(`found data:\n${JSON.stringify(searchdata)}`);
    //   if (searchdata != undefined && searchdata.found == false) {

    //   }

    // })
    .catch(err => {
      console.log('Error happened:', err)
      // return res.status(500).send(err); 
    });


})

app.post('/napowrimo/:datesought?', (req, res) => {
  console.log(req.body);
  console.log(req.params);
  let dateSought = formatDate();
  if (req.params.datesought) {
    dateSought = req.params.datesought;
  }

  try {
    console.log(`date sought: ${dateSought}`);

    let newpoemfilename = `napowrimo.${dateSought}.txt`
    //update the text file for the new poem.
    uploadPoemToBlobStorage(newpoemfilename, req.body.newtext);

    //update the 
    return res.json({
      status: 'success',
      message: 'Poem saved!'
    });
  } catch (error) {
    return res.json({
      status: 'error',
      message: `An error occured:\n${error}`
    });
  }

})

app.post("/correctgrammar", function (req, res) {
  getSuggestedGrammar(req.body.drafttext)
    .then(result => {
      let suggestion = autocorrect(req.body.drafttext, result)
      return res.json({
        status: 'Success',
        correction: suggestion,
        message: 'Suggested changes'
      });
    })
    .catch(error => {
      return res.json({
        status: 'Error',
        message: `An error occured:\n${error}`
      });
    });
})

app.get("/poem", function (req, res) {
  console.log('rhyme scheme:', schemelist.type[Math.floor(new Date().getHours() / (24 / schemelist.type.length))]);
  console.log('config setup:', twitconfig);

  for (let index = 0; index < process.env.numberofpoems; index++) {
    var timestamp = new Date().getTime();
    args.scheme = schemelist.type[Math.floor(new Date().getHours() / (24 / schemelist.type.length))];

    poemGen(args.file, args, function (poem) {
      poem.toString();
      // var poemFileName = path.join( __dirname, util.format("poem.gen.%s-%s.txt",timestamp,index));
      var poemFileName = util.format("poem.gen.%s-%s.txt", timestamp, index);

      // try to replace racial slurs with mushrooms.
      var commonmushroom = mushrooms.Mushrooms[Math.floor(Math.random() * mushrooms.Mushrooms.length)].Common;
      var poemtext = poem.output.replace('nigger', commonmushroom).replace('pickaninny', commonmushroom);

      // Send poem to Azure blob storage
      uploadPoemToBlobStorage(poemFileName, poemtext);

      Text2PngPromise(poemtext)
        .then(function (dataUri) {
          //console.log(dataUri);
          console.log('writing poem...\n');
          console.log('poem saved to', poemFileName);

          var postImageOpts = {
            twit: new Twit(twitconfig),
            base64Image: dataUri.replace("data:image/png;base64,", ""),
            altText: 'a picture of Algorithmic poem.',
            caption: `Algo-rhythm poem ${timestamp} #algorithmicpoetry #poetry #nonsenserhyme`
          };

          postImage(postImageOpts, wrapUp);
        })
        .catch(err => {
          console.log('Error happened:', err)
          return res.status(500).send(err);
        });

    });

  }
  return res.status(200).send('OK');
})


app.get("/likedandrecenttweets", function (req, res) {
  var params = {
    q: `from:${process.env.TWITTER_POET_ACCOUNT}`,
    count: 30,
    result_type: 'all',
    lang: 'en'
  }

  getTweets(params)
    .then(data => {
      let retweetedOrLiked = data.statuses.filter(el => el.retweet_count > 0 || el.favorite_count > 0)
      let mostRecent = data.statuses[0]
      for (let i = 0; i < retweetedOrLiked.length; i++) {
        // Get the tweet Id from the returned data
        let id = { id: retweetedOrLiked[i].id_str }

        // console.log(retweetedOrLiked[i])
        console.log('Found: ',
          `${retweetedOrLiked[i].text}\n`,
          `Created at ${retweetedOrLiked[i].created_at}\n`,
          `${retweetedOrLiked[i].retweet_count} retweets, ${retweetedOrLiked[i].favorite_count} likes\n`,
          `(https://twitter.com/${retweetedOrLiked[i].user.screen_name}/status/${id.id})`)

      }

      console.log('Most recent: ',
        `${mostRecent.text}\n`,
        `Created at ${mostRecent.created_at}\n`,
        `${mostRecent.retweet_count} retweets, ${mostRecent.favorite_count} likes\n`,
        `(https://twitter.com/${mostRecent.user.screen_name}/status/${mostRecent.id_str})`)

      let result = { retweetedOrLikedTweets: retweetedOrLiked, mostRecentTweet: mostRecent }
      // console.log(result);
      return res.status(200).send(result);
    })
    .catch(err => {
      console.log('Error happened:', err)
      return res.status(500).send(err);
    });

})

app.listen(port, function () {
  var datetime = new Date();
  var message = "Server runnning on Port:- " + port + "Started at :- " + datetime;
  console.log(message);
});