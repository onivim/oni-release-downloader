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

    let plat = os.platform().toString()

    // Check the architecture for a Windows machine.
    // Check if we are in AppVeyor and download the relevant variable.
    if (plat === "win32") {
        plat = os.arch() === "x32" ? "win32" : "win64"
    } else if (process.env["APPVEYOR"]) {
        plat = process.env["PLATFORM"]
    }

    const binFolder = path.join(baseDir, "bin")
    const downloadManifest = path.join(binFolder, "oni.manifest.json")

    if (fs.existsSync(downloadManifest)) {
        console.log("Found manifest from previous download.")
        const manifest = JSON.parse(fs.readFileSync(downloadManifest).toString("utf8"))

        if (manifest && manifest.repo === repo && manifest.tag === tag && manifest.user === user) {
            console.log(`Artifact already downloaded and up-to-date tag; exiting`)
            process.exit(0)
        } else {
            console.log("Found existing manifest, but did not match tag, repo, and user")
            console.log("Deleting previous binaries.")
            rimraf.sync(binFolder)
            console.log("Deletion successful")
        }
    }

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

                console.log("--Writing manifest file.")
                fs.writeFileSync(downloadManifest, JSON.stringify({
                    user,
                    tag,
                    repo,
                }))
                console.log("--Manifest file was successfully written.")

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
