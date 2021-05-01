# Introduction 
The purpose of creating the MechaPoet project is twofold: 

- To use a publicly available poetry-generating framework generate rough drafts of poems based on either my own work or combinations of my work and other public domain texts. 
- To create a means of providing myself with prompts for writing on a daily basis. Or as often is I feel like. 

## Acknowledgements

This project relies heavily on the poem-gen project, a poem generator created for NaNoGenMo 2014 by Camden Segal. It uses large source texts from Project Gutenberg to make poems.

To find out more about poem-gen, check out https://github.com/CamdenSegal/poem-gen

# Requirements

This project requires access to several API's:

- GrammarBot 
- Twitter 
- A Microsoft Azure storaIge account 

You will need credentials for each of these.

Here are the dependencies for node JS frameworks (you can also see them in the package.json file:

- @azure/storage-blob >=12.0.0
- azure-storage >=2.10.3
- body-parser >=1.19.0
- canvas >=2.7.0
- dotenv >=8.2.0
- express >=4.17.1
- grammarbot >=1.0.3
- needle >=2.6.0
- poem-gen >=0.3.0
- post-image-to-twitter >=1.0.1
- pug >=3.0.2
- pug-bootstrap >=0.0.16
- text2png >=2.3.0
- twit >=2.2.11


# How it works

I built a NodeJS express web site that does the following:

Generates a poem via HTTP GET request (ex: https://yoursite.com/poem):
1. Calls poem-gen to create a poem based on a word map derived from a custom collection of texts.
2. Saves the poem to a Microsoft Azure cloud storage account
3. Converts the text to an image
4. Uploads the image to a Twitter account.

To generate a poem on a scheduled basis, use either a local CRON job, Microsoft Azure Logic App, IFTTT, or similar scheduling tool to kick off the request.
	
Display a daily prompt page (ex: https://yoursite.com/napowrimo): 
1. Pull a poem from the Twitter account 
2. Retrieve the poem from Microsoft Azure cloud storage
    1. The poem, unaltered, will be displayed on the prompt page.
3. Run the poem through the GrammarBot API
    1. The suggested text for the poem will be displayed in a text area on the prompt page
4. Retrieve a writing prompt from Twitter (I'm using MajesticPrompts)
    1. Display picture from the writing prompt on the prompt page.

The prompt page will display one poem a day, one prompt a day. You'll be able to edit the text area, run grammar checks, and save the new poem to cloud storage. To pull up a previous day, use (ex: https://yoursite.com/napowrimo/YYYY-MM-DD)

PLEASE NOTE, you must rename ".RENAME_to_env" to ".env" and update the environment variables before testing. 
