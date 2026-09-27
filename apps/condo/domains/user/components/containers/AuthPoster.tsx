import { Col, Row } from 'antd'
import classNames from 'classnames'
import React, { useEffect, useState } from 'react'

import { useIntl } from '@open-condo/next/intl'
import { Typography } from '@open-condo/ui'

import { PosterProps } from '@condo/domains/common/components/containers/LayoutWithPoster'

import styles from './AuthPoster.module.css'
import {
    NewsIllustration,
    PaymentsIllustration,
    ResidentsIllustration,
    TicketsIllustration,
} from './AuthPosterIllustrations'


const SLIDE_INTERVAL_MS = 6000
const SLIDES = [
    { key: 'tickets', Illustration: TicketsIllustration },
    { key: 'payments', Illustration: PaymentsIllustration },
    { key: 'residents', Illustration: ResidentsIllustration },
    { key: 'news', Illustration: NewsIllustration },
]

export const AuthPoster: React.FC<PosterProps> = ({ Header, Footer }) => {
    const intl = useIntl()
    const [activeIndex, setActiveIndex] = useState(0)

    useEffect(() => {
        const timer = setTimeout(() => setActiveIndex((activeIndex + 1) % SLIDES.length), SLIDE_INTERVAL_MS)
        return () => clearTimeout(timer)
    }, [activeIndex])

    return (
        <div className={styles.authPoster}>
            <div className={styles.authPosterContent}>
                <Row gutter={[0, 60]}>
                    <Col span={24}>
                        {Header}
                    </Col>
                    <Col span={24} className={styles.authPosterText}>
                        <div className={styles.authPosterSlides}>
                            {SLIDES.map(({ key }, index) => (
                                <div
                                    key={key}
                                    className={classNames(styles.authPosterSlide, index === activeIndex && styles.authPosterSlideActive)}
                                    aria-hidden={index !== activeIndex}
                                >
                                    <Row gutter={[0, 20]}>
                                        <Col span={24}>
                                            <Typography.Title level={2}>
                                                {intl.formatMessage({ id: `component.authPoster.slide.${key}.title` as FormatjsIntl.Message['ids'] })}
                                            </Typography.Title>
                                        </Col>
                                        <Col span={24}>
                                            <Typography.Text>
                                                {intl.formatMessage({ id: `component.authPoster.slide.${key}.description` as FormatjsIntl.Message['ids'] })}
                                            </Typography.Text>
                                        </Col>
                                    </Row>
                                </div>
                            ))}
                        </div>
                        <div className={styles.authPosterDots}>
                            {SLIDES.map(({ key }, index) => (
                                <button
                                    key={key}
                                    type='button'
                                    aria-label={String(index + 1)}
                                    className={classNames(styles.authPosterDot, index === activeIndex && styles.authPosterDotActive)}
                                    onClick={() => setActiveIndex(index)}
                                />
                            ))}
                        </div>
                    </Col>
                </Row>
            </div>
            <div className={styles.authPosterFooter}>
                {Footer}
            </div>
            <div className={styles.authPosterImage}>
                {SLIDES.map(({ key, Illustration }, index) => (
                    <div
                        key={key}
                        className={classNames(styles.authPosterIllustration, index === activeIndex && styles.authPosterIllustrationActive)}
                    >
                        <Illustration />
                    </div>
                ))}
            </div>
        </div>
    )
}
