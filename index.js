require('dotenv').config()
const fetch = require('node-fetch')

const processEvent = (e) => {
    console.log(`Processing event: ${e.type}`)
}

//connect the event listener
(async function () {

    const token = process.env.BOARD_TOKEN
    const url = process.env.URL
    const events = `${url}/api/stream/event`

    let retry = 0
    const maxAttempts = 5

    while (true) {
        try {
            console.log(`Calling: ${events}`)
            const resp = await fetch(events, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            console.log('Connected!')
            resp.body.on('data', (chunk) => {
                try {
                    processEvent(JSON.parse(chunk.toString()))
                } catch (error) {
                    console.log('no valid JSON')
                }
            })
            break
        } catch (error) {
            console.log(error)
            retry++
            if(retry >= maxAttempts) {
                console.log(`Maximum attempts (${maxAttempts}) reached. Aborting.`)
                return
            }
            console.log(`Trying again! Attempt: ${retry + 1}.`)
        }
    }
})()