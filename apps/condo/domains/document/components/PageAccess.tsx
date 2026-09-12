import { PermissionsRequired } from '@condo/domains/organization/components/OrganizationRequired'

export const DocumentsReadPermissionRequired = ({ children }) => <PermissionsRequired permissionKeys={['canReadDocuments']} children={children} />
