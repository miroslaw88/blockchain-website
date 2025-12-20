// Utility functions for file operations

import { formatDate } from '../utils';

// Show toast notification
export function showToast(message: string, type: 'error' | 'success' | 'info' = 'error'): void {
    const $container = $('#toastContainer');
    if ($container.length === 0) {
        // Create container if it doesn't exist
        $('body').append('<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 9999;"></div>');
    }
    
    const toastId = `toast-${Date.now()}`;
    const bgClass = type === 'error' ? 'bg-danger' : type === 'success' ? 'bg-success' : 'bg-info';
    const icon = type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️';
    
    const $toast = $(`
        <div class="toast ${bgClass} text-white" role="alert" aria-live="assertive" aria-atomic="true" id="${toastId}">
            <div class="toast-header ${bgClass} text-white border-0">
                <strong class="me-auto">${icon} ${type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Info'}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `);
    
    $('#toastContainer').append($toast);
    
    // Initialize and show toast using Bootstrap
    const toastElement = $toast[0];
    const toast = new (window as any).bootstrap.Toast(toastElement, {
        autohide: true,
        delay: type === 'error' ? 5000 : 3000
    });
    toast.show();
    
    // Remove toast element after it's hidden
    $toast.on('hidden.bs.toast', () => {
        $toast.remove();
    });
}

// Fetch with timeout helper
export async function fetchWithTimeout(url: string, timeout: number = 10000, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const fetchOptions: RequestInit = {
            ...options,
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                ...(options.headers || {}),
            },
        };
        
        // Default to GET if no method specified
        if (!fetchOptions.method) {
            fetchOptions.method = 'GET';
        }
        
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeout}ms. The server may be unreachable or taking too long to respond.`);
        }
        throw error; 
    }
}

// Get file icon based on content type
export function getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    } else if (contentType.startsWith('video/')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
    } else if (contentType.startsWith('audio/')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    } else if (contentType.includes('pdf')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    } else {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    }
}

// Get folder icon
export function getFolderIcon(): string {
    return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
}

// Build breadcrumb navigation HTML
export function buildBreadcrumbs(currentPath: string): string {
    if (!currentPath || currentPath === '' || currentPath === '/') {
        // Root directory - no breadcrumbs needed
        return '';
    }
    
    // Split path into segments
    const segments = currentPath.split('/').filter(seg => seg !== '');
    
    // Build breadcrumb items
    let breadcrumbItems = '<li class="breadcrumb-item"><a href="#" class="breadcrumb-link" data-path="">Root</a></li>';
    
    let accumulatedPath = '';
    segments.forEach((segment, index) => {
        accumulatedPath += '/' + segment;
        // Ensure directory paths end with /
        const pathForNavigation = accumulatedPath + (index < segments.length - 1 ? '/' : '');
        
        const isLast = index === segments.length - 1;
        if (isLast) {
            breadcrumbItems += `<li class="breadcrumb-item active" aria-current="page">${segment}</li>`;
        } else {
            breadcrumbItems += `<li class="breadcrumb-item"><a href="#" class="breadcrumb-link" data-path="${pathForNavigation}">${segment}</a></li>`;
        }
    });
    
    return `
        <nav aria-label="breadcrumb">
            <ol class="breadcrumb mb-0">
                ${breadcrumbItems}
            </ol>
        </nav>
    `;
}

// Format file size
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

