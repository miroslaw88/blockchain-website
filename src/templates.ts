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
                        Create Folder
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
                    <div class="mt-2 d-flex gap-2 justify-content-center">
                        <button class="btn btn-sm btn-primary download-btn" data-merkle-root="${merkleRoot}" data-file-name="${fileName}" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-danger delete-file-btn" data-merkle-root="${merkleRoot}" data-file-name="${fileName}" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
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
                    <div class="mt-2 d-flex gap-2 justify-content-center align-items-center">
                        <span class="badge bg-info d-flex align-items-center" style="height: 32px; padding: 0.25rem 0.5rem;">Directory</span>
                        <button class="btn btn-sm btn-danger delete-folder-btn" data-folder-path="${folderPath}" data-folder-name="${folderName}" title="Delete Folder">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
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
            <div class="modal-dialog modal-dialog-centered">
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

/**
 * Storage Stats Template
 */
export function getStorageStatsTemplate(
    totalStorageBytes: string,
    remainingTime: string,
    subscriptions: Array<{
        id: string;
        storage_bytes: string;
        start_time: string;
        end_time: string;
        duration_seconds: string;
        remaining_seconds: string;
        is_active: boolean;
    }>
): string {
    // Assume there's always 1 subscription
    const sub = subscriptions.length > 0 ? subscriptions[0] : null;
    
    let subscriptionDetailsHTML = '';
    if (sub) {
        const storageBytes = parseInt(sub.storage_bytes || '0', 10);
        const startTime = parseInt(sub.start_time || '0', 10);
        const endTime = parseInt(sub.end_time || '0', 10);
        const remainingSeconds = parseInt(sub.remaining_seconds || '0', 10);
        const durationSeconds = parseInt(sub.duration_seconds || '0', 10);
        
        // Format storage size
        const storageSize = formatFileSizeForTemplate(storageBytes);
        
        // Format dates
        const startDate = startTime > 0 ? formatDateForTemplate(startTime) : 'N/A';
        const endDate = endTime > 0 ? formatDateForTemplate(endTime) : 'N/A';
        
        // Format remaining time
        const daysRemaining = Math.floor(remainingSeconds / 86400);
        const hoursRemaining = Math.floor((remainingSeconds % 86400) / 3600);
        const remainingTime = remainingSeconds > 0 
            ? `${daysRemaining} days, ${hoursRemaining} hours`
            : 'Expired';
        
        // Format duration
        const durationDays = Math.floor(durationSeconds / 86400);
        
        const statusBadge = sub.is_active 
            ? '<span class="badge bg-success">Active</span>'
            : '<span class="badge bg-secondary">Expired</span>';
        
        subscriptionDetailsHTML = `
            <div class="card mb-2 ${sub.is_active ? 'border-success' : 'border-secondary'}">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h6 class="mb-1">Subscription ${statusBadge}</h6>
                            <small class="text-muted">ID: ${sub.id}</small>
                        </div>
                    </div>
                    <div class="row g-2">
                        <div class="col-md-6">
                            <small class="text-muted">Storage:</small>
                            <div><strong>${storageSize}</strong></div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted">Duration:</small>
                            <div><strong>${durationDays} days</strong></div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted">Start:</small>
                            <div><strong>${startDate}</strong></div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted">End:</small>
                            <div><strong>${endDate}</strong></div>
                        </div>
                        <div class="col-md-12">
                            <small class="text-muted">Remaining:</small>
                            <div><strong>${remainingTime}</strong></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        subscriptionDetailsHTML = '<p class="text-muted mb-0">No subscription found</p>';
    }
    
    // Determine if subscription is active
    const hasActiveSubscription = sub && sub.is_active;
    const buttonId = hasActiveSubscription ? 'extendStorageBtn' : 'buyStorageBtn';
    const buttonText = hasActiveSubscription ? 'Extend Storage' : 'Buy Storage';
    const buttonIcon = hasActiveSubscription ? '' : `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="me-1">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
    `;
    
    return `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="mb-0">Storage Statistics</h5>
                    <button class="btn btn-primary" id="${buttonId}">
                        ${buttonIcon}
                        ${buttonText}
                    </button>
                </div>
                
                <div class="row mb-3">
                    <div class="col-md-6">
                        <small class="text-muted">Total Storage:</small>
                        <div><strong>${totalStorageBytes}</strong></div>
                    </div>
                    <div class="col-md-6">
                        <small class="text-muted">Remaining Time:</small>
                        <div><strong>${remainingTime}</strong></div>
                    </div>
                </div>
                
                <hr>
                
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="mb-0">Subscription Details</h6>
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="collapse" data-bs-target="#subscriptionDetails" aria-expanded="false" aria-controls="subscriptionDetails" id="toggleSubscriptionBtn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="me-1">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                        Show Details
                    </button>
                </div>
                <div class="collapse" id="subscriptionDetails">
                    ${subscriptionDetailsHTML}
                </div>
            </div>
        </div>
    `;
}

// Helper functions for template (inline to avoid circular dependencies)
function formatFileSizeForTemplate(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDateForTemplate(timestamp: number): string {
    if (!timestamp || timestamp === 0) return 'N/A';
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString();
    return `${year}-${month}-${day} ${time}`;
}

/**
 * Extend Storage Modal Template
 */
export function getExtendStorageModalTemplate(): string {
    return `
        <div class="modal fade" id="extendStorageModal" tabindex="-1" aria-labelledby="extendStorageModalLabel" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title" id="extendStorageModalLabel">Extend Storage</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form id="extendStorageForm">
                            <div class="mb-3">
                                <label for="extendDurationDays" class="form-label">Extension Duration (days)</label>
                                <input type="number" class="form-control" id="extendDurationDays" 
                                       placeholder="30" value="30" min="1" required autofocus>
                                <div class="form-text">Enter the number of days to extend your storage subscription</div>
                            </div>
                            <div class="mb-3">
                                <label for="extendPayment" class="form-label">Payment Amount</label>
                                <input type="text" class="form-control" id="extendPayment" 
                                       placeholder="0.1stake" value="0.1stake" required>
                                <div class="form-text">Enter payment amount (e.g., "0.1stake")</div>
                            </div>
                            <div id="extendStorageStatus" class="alert alert-info mt-3 d-none" role="alert">
                                <div class="d-flex align-items-center">
                                    <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                                    <span id="extendStorageStatusText">Processing transaction...</span>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="cancelExtendStorageBtn" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="submitExtendStorageBtn" form="extendStorageForm">
                            <span id="extendStorageBtnText">Extend Storage</span>
                            <span id="extendStorageSpinner" class="spinner-border spinner-border-sm ms-2 d-none" role="status"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Buy Storage Modal Template
 */
export function getBuyStorageModalTemplate(): string {
    return `
        <div class="modal fade" id="buyStorageModal" tabindex="-1" aria-labelledby="buyStorageModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="buyStorageModalLabel">Buy Storage</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form id="buyStorageForm">
                            <div class="mb-3">
                                <label for="storageBytes" class="form-label">Storage Size (bytes)</label>
                                <input type="number" class="form-control" id="storageBytes" 
                                       placeholder="1000000000" value="1000000000" min="1" required autofocus>
                                <div class="form-text">Enter the amount of storage in bytes (e.g., 1000000000 = 1GB)</div>
                            </div>
                            <div class="mb-3">
                                <label for="durationDays" class="form-label">Duration (days)</label>
                                <input type="number" class="form-control" id="durationDays" 
                                       placeholder="30" value="30" min="1" required>
                                <div class="form-text">Enter the subscription duration in days</div>
                            </div>
                            <div class="mb-3">
                                <label for="payment" class="form-label">Payment Amount</label>
                                <input type="text" class="form-control" id="payment" 
                                       placeholder="0.1stake" value="0.1stake" required>
                                <div class="form-text">Enter payment amount (e.g., "0.1stake")</div>
                            </div>
                        </form>
                        <div id="buyStorageStatus" class="alert alert-info mt-3 d-none" role="alert">
                            <div class="d-flex align-items-center">
                                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                                <span id="buyStorageStatusText">Processing transaction...</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="submitBuyStorageBtn">
                            <span id="buyStorageBtnText">Buy Storage</span>
                            <span id="buyStorageSpinner" class="spinner-border spinner-border-sm ms-2 d-none" role="status"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Delete File Modal Template
 */
export function getDeleteFileModalTemplate(fileName: string): string {
    return `
        <div class="modal fade" id="deleteFileModal" tabindex="-1" aria-labelledby="deleteFileModalLabel" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title" id="deleteFileModalLabel">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="me-2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            Delete File
                        </h5>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">Are you sure you want to delete the following file?</p>
                        <div class="alert alert-warning mb-3">
                            <strong>${fileName}</strong>
                        </div>
                        <p class="text-danger mb-0"><strong>Warning:</strong> This action cannot be undone.</p>
                        <div id="deleteFileStatus" class="alert alert-info mt-3 d-none" role="alert">
                            <div class="d-flex align-items-center">
                                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                                <span id="deleteFileStatusText">Deleting file...</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="cancelDeleteFileBtn" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-danger" id="confirmDeleteFileBtn">
                            <span id="deleteFileBtnText">Delete File</span>
                            <span id="deleteFileSpinner" class="spinner-border spinner-border-sm ms-2 d-none" role="status"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Delete Folder Modal Template
 */
export function getDeleteFolderModalTemplate(folderName: string): string {
    return `
        <div class="modal fade" id="deleteFolderModal" tabindex="-1" aria-labelledby="deleteFolderModalLabel" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title" id="deleteFolderModalLabel">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="me-2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            Delete Folder
                        </h5>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">Are you sure you want to delete the following folder?</p>
                        <div class="alert alert-warning mb-3">
                            <strong>${folderName}</strong>
                        </div>
                        <div class="alert alert-danger mb-3">
                            <strong>⚠️ Warning:</strong> This will delete the folder and <strong>ALL</strong> its contents recursively.
                        </div>
                        <p class="text-danger mb-0"><strong>This action cannot be undone.</strong></p>
                        <div id="deleteFolderStatus" class="alert alert-info mt-3 d-none" role="alert">
                            <div class="d-flex align-items-center">
                                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                                <span id="deleteFolderStatusText">Deleting folder...</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="cancelDeleteFolderBtn" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-danger" id="confirmDeleteFolderBtn">
                            <span id="deleteFolderBtnText">Delete Folder</span>
                            <span id="deleteFolderSpinner" class="spinner-border spinner-border-sm ms-2 d-none" role="status"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

