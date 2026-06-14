## Direct Downloads

### Direct Download Temporary Folder

This is where the files being downloaded get written to before being processed and moved to the correct location.

If you run Kapowarr using Docker, leave this set to the default value of `/app/temp_downloads` and instead change the value of `/path/to/download_folder` in the [Docker command](../installation/docker.md#launch-container). If you have a manual install, you can change this value to whatever you want. It is required to be outside your root folders.

### Empty Temporary Download Folder

This isn't so much of a setting as it is a tool. It will delete all files from the download folder that aren't actively being downloaded. This can be handy if the application crashed while downloading, leading to half-downloaded 'ghost' files in the folder.  

## Download Queue Handling

### Concurrent Downloads

The amount of direct downloads (DDLs) that are allowed to run at the same time.

### Failing Download Timeout

If a download is stalled (no seeders, no servers, no metadata found, etc.) for a long time, you can be pretty confident that it's not going to work. Kapowarr can automatically delete a download when it's stalled for a set amount of minutes. So for example, if you set it to 60, then Kapowarr will delete downloads that have been stalled for more than 60 minutes. Make the field empty (or set it to 0) to disable this feature.

### Seeding Handling

When a torrent has completed downloading, it will start to seed depending on the settings of the torrent client. The originally downloaded files need to be available in order to seed. But you might not want to wait for the torrent to complete seeding before you can read the downloaded media. Kapowarr offers two solutions:

1. **Complete**  
Wait until the torrent has completed seeding and then move the files. You'll have to wait until the torrent has completed seeding before the comics are available.

2. **Copy**  
Make a copy of the downloaded files and post-process those (moving, renaming, converting, etc.). When the torrent finishes seeding, its files are deleted. With this setup, your downloaded comics will be available immediately, but will temporarily take up twice as much space.

### Delete Completed Downloads

Whether external downloads should be deleted from their client once they have completed. Otherwise leave them in the queue of the external download client as 'completed'.

## GetComics Service Preference

Kapowarr has the ability to download directly from the servers of GetComics, but also to download from services like MediaFire and Mega. When a download on GetComics is found and  has multiple possible download sources, this defines which source takes priority. If the first download fails, Kapowarr will try the next service in order.

If you have an account for one of these services (see [Credentials](#credentials)), you might want to put that one at the top, to make Kapowarr take advantage of the extra features that the account offers (extra bandwidth, higher rate limit, etc.).

## Built-in Download Services

A list of the download clients Kapowarr has built-in. It uses these to download from multiple sources offered by GetComics. Clicking on one of them shows a window with more information and, if the client has support for it, an option to enter credentials (see below).

### Credentials

If you have an account with Mega or Pixeldrain, Kapowarr has the ability to use this account. If you provide your login credentials for the service, Kapowarr will then take advantage of the extra features that your account has access to (higher speeds and limits, usually). You can enter the credentials by clicking on the client and filling in the form.

## External Torrent Clients

By adding at least one torrent client, Kapowarr is able to download torrents.

!!! warning "Using localhost in combination with a Docker container"
    If the torrent client is hosted on the host OS, and Kapowarr is running inside a Docker container, then it is not possible to use `localhost` in the base URL of the torrent client. Instead, the IP address used by the host OS must be used.

## External Usenet Clients

By adding at least one usenet client, Kapowarr is able to download NZBs.

## Remote Path Mappings

When a remote download client and Kapowarr do not run on the same machine (because at least one of them is on another machine or in a Docker container), then filepaths could not match up. For example, a torrent client might be running in a Docker container where the download folder is at `/downloads` which maps to `/home/media/downloads` on the host while Kapowarr is running on the host. Then when Kapowarr reaches out to the torrent client, it'll report that the file is located at `/downloads/file.ext`. But Kapowarr can actually find it at `/home/media/downloads/file.ext`. 'Remote Path Mappings' allows you to add such a mapping so that Kapowarr can translate filepaths that are reported by the external download client to where it can actually find it.

When adding a remote mapping, choose the client it's for and then set the paths. The remote path is the path that the client reports (e.g. `/downloads`). The local path is the path that Kapowarr should actually look (e.g. `/home/media/downloads`).

!!! warning "Cross-OS remote mapping"
    Kapowarr currently does not support remote mappings between different operating systems. So for example, if a client is running on Windows and Kapowarr on Linux, then it currently doesn't support translating those.

## Suwayomi

Connect to a self-hosted [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) to automatically download manga chapters from its library. Configure the server URL and optional credentials, then select which Suwayomi extensions (sources) to use and their priority order.
