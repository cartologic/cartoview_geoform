import './css/geoform.css'

import React, { Component } from 'react'
import { Route, Router } from 'react-router'

import AlertContainer from 'react-alert'
import FileBase64 from 'react-file-base64'
import InfoPage from './components/InfoPage'
import MapViewer from './components/MapViewer.jsx'
import QuestionModal from './components/QuestionModal'
import ReactDOM from 'react-dom'
import WFSClient from './utils/WFSClient.jsx'
import { getCRSFToken } from './helpers/helpers.jsx'
import history from './components/history'
import ol from 'openlayers'
import t from 'tcomb-form'

var modalStyle = {
    transform: 'rotate(45deg) translateX(-50%)',
};
var backdropStyle = {
    backgroundColor: 'red'
};
var contentStyle = {
    backgroundColor: 'blue',
    height: '100%'
};
// check if number is int
const Int = t.refinement(t.Number, (n) => n % 1 == 0)
const getSRSName = (geojson) => {
    //"EPSG:900913"
    const srs = geojson.crs.properties.name.split(":").pop()
    return "EPSG:" + srs
}
class AttrsForm extends Component {
    getValue() {
        return this.form.getValue()
    }
    render() {
        const { attributes } = this.props
        const schema = {},
            fields = {},
            value = {}
        attributes.forEach(a => {
            if (a.included) {
                fields[a.name] = {
                    label: a.label,
                    help: a.helpText,
                    type: a.fieldType,
                    attrs: {
                        placeholder: a.placeholder
                    }
                }
                value[a.name] = a.defaultValue
                if (a.fieldType == "select") {
                    const options = {}
                    a.options.forEach(o => options[o.value] = o
                        .label)
                    schema[a.name] = t.enums(options)
                } else if (a.fieldType == "number") {
                    fields[a.name].type = 'number'
                    schema[a.name] = a.dataType == "int" ? Int :
                        t.Number
                } else if (a.fieldType == "checkbox") {
                    schema[a.name] = t.Bool
                }
                //default case if data type is string
                // here field type may be text or textarea
                else if (a.dataType == "string") {
                    schema[a.name] = t.String
                }
                if (schema[a.name]) {
                    if (a.required) {
                        fields[a.name].help += " (Required)"
                    } else {
                        schema[a.name] = t.maybe(schema[a.name])
                    }
                }
            }
        })
        return (
            <div className="panel panel-primary">
                <div className="panel-heading">Enter Information</div>
                <div className="panel-body">
                    <t.form.Form ref={f => this.form = f} type={t.struct(schema)} options={{ fields }} value={value} />
                </div>
            </div>
        )
    }
}
class FileForm extends Component {
    constructor(props) {
        super(props)
        this.state = {
            file: null,
            messages: ""
        }
    }
    getValue() {
        let file = this.state.file
        if (!file) {
            this.setState({ messages: "Please select an image" })
        }
        return file
    }
    getFiles(file) {
        let imageRegx = new RegExp('^image\/*', 'i')
        if (imageRegx.test(file.type)) {
            if (Math.ceil(file.file.size / Math.pow(1024, 2), 2) >
                5) {
                this.setState({ messages: "Max File Size is 5 MB" })
            } else {
                this.setState({ file: file, messages: "" })
            }
        } else {
            this.setState({ messages: "this file isn't an image" })
        }
    }
    render() {
        let { messages, file } = this.state
        return (
            <div className="panel panel-primary">
                <div className="panel-heading">Images</div>
                <div className="panel-body">
                    <FileBase64
                        multiple={false}
                        onDone={this.getFiles.bind(this)} />
                    <h4 style={{ color: "red" }}>{messages}</h4>
                    {file && <div className="row" style={{ marginTop: "5%" }}>
                        <div className="col-xs-12 col-sm-12 col-md-6 col-md-offset-3">
                            <img className="img-responsive" src={file.base64} />
                        </div>
                    </div>}
                </div>
            </div>
        )
    }
}
class GeoCollect extends Component {
    constructor(props) {
        super(props)
        this.state = {
            currentComponent: "infoPage",
            showModal: false,
            proceed: false,
            moving: false
        }
        this.map = new ol.Map({
            layers: [new ol.layer.Tile({
                title: 'OpenStreetMap',
                source: new ol.source.OSM()
            })],
            view: new ol.View({
                center: [
                    0, 0
                ],
                zoom: 3
            })
        })
    }
    WFS = new WFSClient(this.props.geoserverUrl)
    onSubmit = (e) => {
        e.preventDefault()
        if (this.form.getValue() && this.xyForm.getValue() && this.fileForm.getValue()) {
            this.showModal()
        }
    }
    saveAll = () => {
        const { layer, geometryName, uploadUrl } = this.props
        const properties = Object.assign({}, this.form.getValue())
        const geometry = Object.assign({
            name: geometryName,
            srsName: "EPSG:4326"
        }, this.xyForm.getValue())
        this.setState({
            saving: true
        })
        this.WFS.insertFeature(layer, properties, geometry).then(res =>
            res.text()).then((xml) => {
                // console.log( xml )
                const parser = new DOMParser()
                const xmlDoc = parser.parseFromString(xml, "text/xml")
                const featureElements = xmlDoc.getElementsByTagNameNS(
                    'http://www.opengis.net/ogc', 'FeatureId')
                if (featureElements.length > 0) {
                    const fid = featureElements[0].getAttribute(
                        "fid")
                    const fileFormValue = this.fileForm.getValue()
                    const data = { file: fileFormValue.base64, file_name: fileFormValue.name, username: this.props.username,is_image:true, feature_id: fid,tags:['geo_collect_'+this.layerName()] }
                    //TODO: remove static url
                    fetch(`/apps/cartoview_attachment_manager/${this.layerName()}/file`, {
                        method: 'POST',
                        credentials: "same-origin",
                        headers: new Headers({
                            "Content-Type": "application/json; charset=UTF-8",
                            "X-CSRFToken": getCRSFToken()
                        }),
                        body: JSON.stringify(data)
                    }).then((response) => response.json()).then(res => {
                        // history.push( '/' )
                        if (res.error) {
                            this.msg.show(
                                'Error while saving Data please Contact our Support', {
                                    time: 5000,
                                    type: 'success',
                                    icon: <i style={{ color: "#e2372a" }} className="fa fa-times-circle-o fa-lg" aria-hidden="true"></i>
                                })
                        } else {
                            this.setState({ saving: false })
                            this.msg.show(
                                'Your Data Saved successfully', {
                                    time: 5000,
                                    type: 'success',
                                    icon: <i style={{ color: "#4caf50" }} className="fa fa-check-square-o fa-lg" aria-hidden="true"></i>
                                })
                        }

                    }).catch((error) => {
                        this.msg.show(
                            'Error while saving Data please Contact our Support', {
                                time: 5000,
                                type: 'success',
                                icon: <i style={{ color: "#e2372a" }} className="fa fa-times-circle-o fa-lg" aria-hidden="true"></i>
                            })
                    })
                    // fetch(`/apps/cartoview_attachment_manager/${this.layerName()}/comment`, {
                    //     method: 'POST',
                    //     credentials: 'include',
                    //     body: fd
                    // }).then(res => res.json()).then(res => {
                    //     // history.push( '/' )
                    //     this.setState({ saving: false })
                    //     this.msg.show(
                    //         'Your Data Saved successfully', {
                    //             time: 5000,
                    //             type: 'success',
                    //             icon: <i style={{ color: "#4caf50" }} className="fa fa-check-square-o fa-lg" aria-hidden="true"></i>
                    //         })
                    // }).catch((error) => {
                    //     this.msg.show(
                    //         'Error while saving Data please Contact our Support', {
                    //             time: 5000,
                    //             type: 'success',
                    //             icon: <i style={{ color: "#e2372a" }} className="fa fa-times-circle-o fa-lg" aria-hidden="true"></i>
                    //         })
                    // })
                }
                //ogc:FeatureId
            }).catch((error) => {
                this.msg.show(
                    'Error while saving Data please Contact our Support', {
                        time: 5000,
                        type: 'success',
                        icon: <i style={{ color: "#e2372a" }} className="fa fa-times-circle-o fa-lg" aria-hidden="true"></i>
                    })
            })
    }
    layerName() {
        return this.props.layer.split(":").pop()
    }
    getXYForm() {
        const { xyValue } = this.state
        const xyFormSchema = t.struct({
            x: t.Number,
            y: t.Number
        })
        const options = {
            fields: {
                x: {
                    label: "Longitude (X)",
                    type: "number"
                },
                y: {
                    label: "Latitude (Y)",
                    type: "number"
                }
            }
        }
        return <t.form.Form ref={f => this.xyForm = f} type={xyFormSchema}
            options={options}
            value={xyValue}
            onChange={(xyValue) => this.setState({ xyValue })} />
    }
    onFeatureMove = (coords) => {
        const center = ol.proj.transform(coords, 'EPSG:900913',
            'EPSG:4326')
        this.setState({
            xyValue: {
                x: center[0],
                y: center[1]
            },
            moving: true
        })
    }
    showModal = () => {
        this.setState({ showModal: !this.state.showModal })
    }
    onMapReady = (map) => {
        if (!this.props.EnableGeolocation) {
            this.onFeatureMove(map.getView().getCenter())
        }
    }
    changeXY = (xy) => {
        this.setState({ xyValue: xy })
    }
    onYes = () => {
        this.saveAll()
    }
    toggleComponent = (component) => {
        console.log(component)
        this.setState({ currentComponent: component })
    }
    alertOptions = {
        offset: 14,
        position: 'top right',
        theme: 'light',
        time: 5000,
        transition: 'scale'
    }
    render() {
        const { formTitle, mapId, attributes, appName, description } =
            this.props
        const { xyValue, saving, currentComponent } = this.state
        return (
            <div className="row" style={{ paddingTop: 50, paddingBottom: 50 }}>
                <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                    <AlertContainer ref={a => this.msg = a} {...this.alertOptions} />
                    <div>
                        {this.state.showModal && <QuestionModal handleHideModal={this.showModal} onYes={this.onYes} />}
                        <div className="row collector-title">
                            <div style={{ textAlign: '-webkit-center' }} className="col-xs-4 col-sm-2 col-md-2 vcenter">
                                <img style={{ height: 60 }} className="img-responsive img-rounded" src={this.props.logo.base64} />

                            </div>
                            <div className="col-xs-8 col-sm-9 col-md-9 vcenter">
                                <span className="h3"><b>{formTitle || 'Add'}</b></span>
                            </div>
                        </div>
                        <AttrsForm key="attrsForm" attributes={attributes} ref={f => this.form = f} />
                        <FileForm message={this.state.message} ref={f => this.fileForm = f} key="fileform" />
                        <div className="panel panel-primary" style={{ display: "none" }}>
                            <div className="panel-heading">Select Location</div>
                            <div className="panel-body">
                                {this.getXYForm()}
                            </div>
                        </div>
                        <div>
                            <MapViewer moving={this.state.moving} changeXY={this.changeXY} map={this.map} mapId={mapId} xy={xyValue} onMapReady={this.onMapReady} onFeatureMove={this.onFeatureMove} EnableGeolocation={this.props.EnableGeolocation} />
                        </div>
                        <hr />
                        <div className="form-group" style={{ marginTop: "2%" }}>
                            <button onClick={this.onSubmit} className="btn btn-primary" disabled={saving}>
                                {saving && <div className="loading"></div>}
                                Submit
                                </button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}
global.GeoCollect = {
    show: (el, props) => {
        var geoCollect = React.createElement(GeoCollect, props)
        ReactDOM.render(
            <Router history={history}>
                <div>
                    <Route exact path="/" render={() => <InfoPage description={props.formAbstract} title={props.formTitle} />} />
                    <Route path="/form" render={() => <GeoCollect {...props} />} />
                </div>
            </Router>,
            document.getElementById(el))
    }
}
export default GeoCollect
