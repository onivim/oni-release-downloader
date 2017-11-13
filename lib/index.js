// @ts-check
'use strict'

const cp = require("child_process")
const fs = require("fs")
const fse = require("fs-extra")
const os = require("os")
const path = require("path")

const extract = require("extract-zip")
const Github = require("github-releases")
const mkdirp = require("mkdirp")
const rimraf = require("rimraf")

const downloadGithubRelease = async (baseDir, downloadMetadata) => {

    const user = downloadMetadata.user
    const repo = downloadMetadata.repo
    const token = process.env["GITHUB_TOKEN"]
    const tag = downloadMetadata.tag

    const plat = os.platform()

    const artifactMetadata = downloadMetadata.platforms[plat]

    if (!artifactMetadata) {
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

    const copyToOutputLocation = (expandFolder, destinationFolder) => {
        if (artifactMetadata.root) {
            expandFolder = path.join(expandFolder, artifactMetadata.root)
        }

        console.log(`--Copying from ${expandFolder} to ${destinationFolder}`)

        fse.copySync(expandFolder, destinationFolder)

        if (artifactMetadata.chmod && artifactMetadata.chmod.length) {
            artifactMetadata.chmod.forEach((executableToMod) => {
                const fullPathToChange = path.join(destinationFolder, executableToMod)
                console.log(`--Running chmod on ${executableToMod}`)
                fs.chmodSync(fullPathToChange, "755")
                console.log("--chmod complete")
            })
        }
    }

    return new Promise((resolve, reject) => {
        gitHub.getReleases({ tag_name: tag }, async (err, releases) => {
            try {
                if (err) {
                    console.error(err)
                    reject(err)
                    return
                }

                if (!releases || !releases.length) {
                    reject("Unable to find release for: " + tag)
                    return
                }

                const release = releases[0]

                const assetName = artifactMetadata.name
                const asset = release.assets.find((assetInfo) => assetInfo.name === assetName)

                if (!asset) {
                    reject("Could not find asset: " + assetName)
                    return
                }

                console.log("--Found matching asset: " + assetName)

                const downloadFolder = path.join(baseDir, "_temp")
                const downloadFilePath = path.join(downloadFolder, assetName)

                mkdirp.sync(downloadFolder)

                const expandFolder = path.join(baseDir, "_temp-expand")
                mkdirp.sync(expandFolder)

                await downloadAsset(asset, downloadFilePath)
                console.log("--Download complete!")

                const binFolder = path.join(baseDir, "bin")

                mkdirp.sync(binFolder)

                console.log("--Extracting zip: " + downloadFilePath)


                if (path.extname(assetName) === ".zip") {
                    await unzipWindows(downloadFilePath, expandFolder)
                    copyToOutputLocation(expandFolder, binFolder)
                } else if (path.extname(assetName) === ".gz") {
                    await unzipOSX(downloadFilePath, expandFolder)
                    copyToOutputLocation(expandFolder, binFolder)
                } else {
                    fs.copyFileSync(downloadFilePath, path.join(binFolder, assetName))
                }
                console.log("--Extraction complete!")

                console.log("--Cleaning up download folder: " + downloadFolder)
                rimraf.sync(downloadFolder)
                console.log("--Successfully deleted download folder.")

                console.log("--Cleaning up expand folder: " + expandFolder)
                rimraf.sync(expandFolder)
                console.log("--Successfully deleted expand folder.")

                resolve()
            } catch (ex) {
                console.error(ex)
                process.exit(1)
            }
        })
    })
}

module.exports = {
    downloadGithubRelease,
}
