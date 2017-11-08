// @ts-check
'use strict'

const cp = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const extract = require("extract-zip")
const Github = require("github-releases")
const mkdirp = require("mkdirp")
const rimraf = require("rimraf")

const packageFile = path.join(process.cwd(), "package.json")

const packageMeta = JSON.parse(fs.readFileSync(packageFile).toString("utf8"))

const downloadMetadata = packageMeta["downloadArtifacts"]

const user = downloadMetadata.user
const repo = downloadMetadata.repo
const token = process.env["GITHUB_TOKEN"]
const tag = downloadMetadata.tag

const plat = os.platform()

const artifactToDownload = downloadMetadata.platforms[plat]

if (!artifactToDownload) {
    console.log(`No artifact specified to download for platform ${plat}; exiting`)
    process.exit(0)
}


const gitHub = new Github({ user, repo, token })

const downloadAsset = (asset, downloadPath) => {

    return new Promise((resolve, reject) => {

        gitHub.downloadAsset(asset, (error, stream) => {
            if (error) {
                reject(error)
            }

            const writeStream = fs.createWriteStream(downloadPath)

            stream.pipe(writeStream)
            writeStream.on("close", () => resolve())

        })
    })

}

const unzipOSX = async (downloadFilePath, outputFolder) => {
    cp.execSync("gunzip -c \"" + downloadFilePath + "\" | tar -xop", { cwd: outputFolder })
}

const unzipWindows = async (downloadFilePath, outputFolder) => {
    return new Promise((resolve, reject) => {
        extract(downloadFilePath, { dir: outputFolder }, (err) => {

            if (err) {
                reject(err)
                return
            }
            resolve()
        })
    })
}

gitHub.getReleases({ tag_name: tag }, async (err, releases) => {
    try {
        if (err) {
            throw err
        }

        const release = releases[0]

        if (!release) {
            throw new Error("Unable to find release for: " + tag)
        }

        const assetName = artifactToDownload
        const asset = release.assets.find((assetInfo) => assetInfo.name === assetName)

        if (!asset) {
            throw new Error("Could not find asset: " + assetName)
        }

        console.log("--Found matching asset: " + assetName)

        const downloadFolder = path.join(process.cwd(), "_temp")

        const downloadFilePath = path.join(downloadFolder, assetName)

        mkdirp.sync(downloadFolder)

        await downloadAsset(asset, downloadFilePath)
        console.log("--Download complete!")

        const binFolder = path.join(process.cwd(), "bin")

        mkdirp.sync(binFolder)

        console.log("--Extracting zip: " + downloadFilePath)


        if (path.extname(assetName) === ".zip") {
            await unzipWindows(downloadFilePath, binFolder)
        } else if (path.extname(assetName) === ".gz") {
            await unzipOSX(downloadFilePath, binFolder)
        } else {
            fs.copyFileSync(downloadFilePath, path.join(binFolder, assetName))
        }

        rimraf.sync(downloadFolder)
        console.log("--Extraction complete!")
    } catch (ex) {
        console.error(ex)
        process.exit(1)
    }
})
