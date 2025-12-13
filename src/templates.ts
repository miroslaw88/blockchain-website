// HTML Templates for the application

/**
 * Files View Template
 * Main template structure for displaying files and folders
 */
export function getFilesViewTemplate(walletAddress: string): string {
    return `
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0" id="filesViewHeader">Files and Folders (0 files, 0 folders)</h5>
                <div class="d-flex align-items-center gap-2">
                    <button class="btn btn-sm btn-outline-primary" id="createFolderToolbarBtn" title="Create Folder">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            <line x1="12" y1="11" x2="12" y2="17"></line>
                            <line x1="9" y1="14" x2="15" y2="14"></line>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="card-body" id="filesViewBody">
                <div id="filesViewBreadcrumbs"></div>
                <div id="filesViewContent"></div>
            </div>
        </div>
    `;
}

/**
 * Empty State Template
 * Displayed when no files or folders are found
 */
export function getEmptyStateTemplate(): string {
    return `
        <div class="text-center py-5">
            <p class="text-muted">No files or folders found</p>
        </div>
    `;
}

/**
 * File Thumbnail Template
 */
export function getFileThumbnailTemplate(
    fileName: string,
    fileSize: string,
    uploadDate: string,
    expirationDate: string,
    merkleRoot: string,
    contentType: string,
    isExpired: boolean,
    fileIcon: string
): string {
    return `
        <div class="col-md-3 col-sm-4 col-6 mb-4">
            <div class="card h-100 file-thumbnail ${isExpired ? 'border-warning' : ''}" style="transition: transform 0.2s;">
                <div class="card-body text-center p-3">
                    <div class="file-icon mb-2" style="color: #6c757d;">
                        ${fileIcon}
                    </div>
                    <h6 class="card-title mb-1 text-truncate" style="font-size: 0.9rem;" title="${fileName}">${fileName}</h6>
                    <p class="text-muted small mb-1">${fileSize}</p>
                    ${isExpired ? '<span class="badge bg-warning text-dark mb-2">Expired</span>' : ''}
                    <div class="mt-2">
                        <button class="btn btn-sm btn-primary download-btn" data-merkle-root="${merkleRoot}" data-file-name="${fileName}" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="card-footer bg-transparent border-0 pt-0 pb-2">
                    <small class="text-muted d-block" style="font-size: 0.75rem;">Uploaded: ${uploadDate}</small>
                    <small class="text-muted d-block" style="font-size: 0.75rem;">Expires: ${expirationDate}</small>
                </div>
            </div>
        </div>
    `;
}

/**
 * Folder Thumbnail Template
 */
export function getFolderThumbnailTemplate(
    folderName: string,
    folderPath: string,
    folderIcon: string
): string {
    return `
        <div class="col-md-3 col-sm-4 col-6 mb-4">
            <div class="card h-100 file-thumbnail folder-thumbnail" style="transition: transform 0.2s; cursor: pointer;" data-folder-path="${folderPath}">
                <div class="card-body text-center p-3">
                    <div class="file-icon mb-2" style="color: #ffc107;">
                        ${folderIcon}
                    </div>
                    <h6 class="card-title mb-1 text-truncate" style="font-size: 0.9rem;" title="${folderName}">${folderName}</h6>
                    <p class="text-muted small mb-1">Folder</p>
                    <div class="mt-2">
                        <span class="badge bg-info">Directory</span>
                    </div>
                </div>
                <div class="card-footer bg-transparent border-0 pt-0 pb-2">
                    <small class="text-muted d-block" style="font-size: 0.75rem;">Path: ${folderPath}</small>
                </div>
            </div>
        </div>
    `;
}

/**
 * Entries Grid Template
 * Wrapper for the files/folders grid
 */
export function getEntriesGridTemplate(entriesGrid: string): string {
    return `
        <div class="row mt-3">
            ${entriesGrid}
        </div>
    `;
}

/**
 * Create Folder Modal Template
 */
export function getCreateFolderModalTemplate(currentPath: string): string {
    const displayPath = currentPath === '/' ? '/ (root)' : currentPath;
    return `
        <div class="modal fade" id="createFolderModal" tabindex="-1" aria-labelledby="createFolderModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="createFolderModalLabel">Create Folder</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form id="createFolderForm">
                            <div class="mb-3">
                                <label for="folderName" class="form-label">Folder Name</label>
                                <input type="text" class="form-control" id="folderName" 
                                       placeholder="my-folder" required autofocus>
                                <div class="form-text">
                                    Folder will be created in: <code>${displayPath}</code>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="submitCreateFolderBtn">
                            <span id="createFolderBtnText">Create Folder</span>
                            <span id="createFolderSpinner" class="spinner-border spinner-border-sm ms-2 d-none" role="status"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Error Template
 * Displayed when there's an error fetching files
 */
export function getErrorTemplate(errorMessage: string): string {
    return `
        <div class="alert alert-danger" role="alert">
            <h5 class="alert-heading">Error Fetching Files</h5>
            <p><strong>Error:</strong> ${errorMessage}</p>
            <hr>
            <p class="mb-1"><strong>Troubleshooting:</strong></p>
            <ul class="mb-0">
                <li><strong>Code 12 / Status 501:</strong> This usually means Caddy isn't routing the request to your blockchain API server. Check your Caddyfile configuration.</li>
                <li>Ensure your blockchain node is running on <code>localhost:1337</code></li>
                <li>Verify Caddyfile has: <code>handle_path /osd-blockchain* { reverse_proxy 127.0.0.1:1337 }</code></li>
                <li>Test the endpoint directly: <code>curl http://localhost:1337/osd-blockchain/osdblockchain/v1/files/owner/{address}</code></li>
                <li>Reload Caddy after config changes: <code>sudo systemctl reload caddy</code></li>
                <li>Check Caddy logs: <code>sudo journalctl -u caddy -f</code></li>
            </ul>
        </div>
    `;
}

/**
 * Loading State Template
 */
export function getLoadingTemplate(): string {
    return `
        <div class="text-center">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Loading files...</p>
            <p class="text-muted small">This may take a few seconds...</p>
        </div>
    `;
}

