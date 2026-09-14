import Head from 'next/head'
import React, { useCallback, useMemo } from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { TablePageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import { Loader } from '@condo/domains/common/components/Loader'
import { useGlobalHints } from '@condo/domains/common/hooks/useGlobalHints'
import { PageComponentType } from '@condo/domains/common/types'
import { DocumentsReadPermissionRequired } from '@condo/domains/document/components/PageAccess'
import { OrganizationDocuments } from '@condo/domains/document/components/OrganizationDocuments'
import { Document } from '@condo/domains/document/utils/clientSchema'


const DocumentsPageContent: React.FC = () => {
    const intl = useIntl()
    const PageTitleMessage = intl.formatMessage({ id: 'documents.title' })

    const { GlobalHints } = useGlobalHints()
    const { organization, role, isLoading } = useOrganization()
    const organizationId = useMemo(() => organization?.id || null, [organization?.id])

    const {
        count: documentsCount,
        loading: documentsCountLoading,
        refetch: refetchDocumentsCount,
    } = Document.useCount({
        where: { organization: { id: organizationId }, property_is_null: true },
    }, { skip: !organizationId })

    const refetch = useCallback(() => refetchDocumentsCount(), [refetchDocumentsCount])

    return (
        <>
            <Head>
                <title>{PageTitleMessage}</title>
            </Head>
            <PageWrapper>
                {GlobalHints}
                <PageHeader title={<Typography.Title>{PageTitleMessage}</Typography.Title>}/>
                <TablePageContent>
                    {
                        isLoading || documentsCountLoading || !organizationId
                            ? <Loader />
                            : (
                                <OrganizationDocuments
                                    organizationId={organizationId}
                                    role={role}
                                    documentsCount={documentsCount}
                                    refetchDocumentsCount={refetch}
                                />
                            )
                    }
                </TablePageContent>
            </PageWrapper>
        </>
    )
}

const DocumentsPage: PageComponentType = () => <DocumentsPageContent />

DocumentsPage.requiredAccess = DocumentsReadPermissionRequired

export default DocumentsPage
