/**
 * FormController
 *
 * @description :: Server-side logic for managing forms
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {

	// métodos del modelo:

	paso1: function (req, res) {

		req.session.authenticated = 1;

		Paises.find({PaisVer:'S'}).exec(function(err, paises){
			if (err) {
					return res.serverError(err);
			}

			req.session.paises = paises;

			return res.view({paises:paises,perdocid:req.session.perdocid});
		});
	},

	paso2: function (req, res) {

		var pais = req.param('pais') ? req.param('pais').substr(0,2) : req.session.pais;
		var doccod = req.param('doccod') ? req.param('doccod').substr(0,3) : req.session.doccod;
		var perdocid = req.param('perdocid') ? req.param('perdocid').replace(/[^0-9a-zA-Z]/g,'').substr(0,15) : req.session.perdocid;

		if (!req.session.perdocid || perdocid!=req.session.perdocid) {
			// salvo la cantidad de intentos con cédulas diferentes para evitar abusos
			req.session.intentos += 1;
		}

		turnosDesc={'1':'Matutino', '2':'Tarde', '3':'Vespertino', '4':'Nocturno', 'D':'Diurno', 'N':'Nocturno'};

		// valido los parámetros
		if (!pais || !doccod || !perdocid) {
			return res.serverError(new Error("parámetros incorrectos"));
		}
		if (!pais.match('^[A-Z][A-Z]$') && !doccod.match('^[A-Z]+$') && !perdocid.match('^[a-zA-Z0-9 -]+$')) {
			return res.serverError(new Error("documento de alumno inválido"));
		}
		// obtengo el id del alumno:
		Personas.buscar(pais,doccod,perdocid,function(err, persona){
			if (err) {
				return res.serverError(err);
			}

			if (typeof persona === 'undefined') {
				return res.view({mensaje:"No se encuentra una persona registrada con el documento dado.<br>Si ingresó correctamente el número de documento debe consultar dónde inscribirse en <a href='http://ces.edu.uy/index.php/reguladora-estudiantil'>el sitio web de CES</a>"});
			}

			var inicioCurso = sails.config.anioinscripcion() + "-03-01T03:00:00Z";
			req.session.inicioCurso = inicioCurso;
			Inscripciones.find({PerId:persona.perId,EstadosInscriId:{'<':5},FechaInicioCurso:inicioCurso})
									 .sort('EstadosInscriId')
									 .sort('InscripcionId DESC')
									 .populate('DependId')
									 .populate('PlanId')
									 .populate('CicloId')
									 .populate('GradoId')
									 .populate('OrientacionId')
									 .populate('OpcionId')
									 .populate('EstadosInscriId')
									 .exec(function(err,inscripciones) {
				if (err) {
					return res.serverError(err);
				}

				if (typeof inscripciones === 'undefined' || typeof inscripciones[0] === 'undefined') {
					console.log("no hay inscripcion para "+perdocid);
					return res.view({mensaje:"No se encuentra una inscripción registrada para el documento dado"});
				}
				Dependencias.direccion(inscripciones[0].DependId.DependId, function(err, direccion) {
					if (err) {
						return res.serverError(err);
					}

					// salvo los parámetros en la sesión
					req.session.pais = pais;
					req.session.doccod = doccod;
					req.session.perdocid = perdocid;
					req.session.documento = pais!=='UY' || doccod!=='CI' ? pais+'-'+doccod+'-'+perdocid : perdocid.fmtCedula();

					// salvo en la sesión el resto de la información
					req.session.persona = persona;
					req.session.inscripciones = inscripciones;
					req.session.direccion = direccion;

					// limpio otros campos de la sesión que pueden haber quedado de una corrida anterior
					req.session.liceos = undefined;
					req.session.reserva = undefined;
					req.session.destino = undefined;
					req.session.destinoId = undefined;

					Reserva.findOne({PerId:persona.perId,Vencimiento:{'>=':new Date().fecha_ymd_toString()},DependId:{'>':0}})
								 .populate('DependId')
								 .exec(function(err,reserva){
						if (err) {
							return res.serverError(err);
						}

						if (typeof reserva === 'undefined') {
							return res.view({persona:persona,inscripciones:inscripciones,direccion:direccion,turnosDesc:turnosDesc,reserva:null,entrevista:null,paseshabilitados:sails.config.paseshabilitados()});
						}

						req.session.reserva = reserva;

						Entrevista.findOne({Reserva:reserva.id,Activa:1,FechaHora:{'>=':new Date().fecha_ymd_toString()}}).exec(function(err,entrevista){
							if (err) {
								return res.serverError(err);
							}
							return res.view({persona:persona,inscripciones:inscripciones,direccion:direccion,turnosDesc:turnosDesc,reserva:reserva,entrevista:entrevista,paseshabilitados:sails.config.paseshabilitados()});
						});
					});
				});
			});
		});
	},

	paso3: function (req, res) {
		var deptoId = typeof req.session.deptoId !== 'undefined' ? req.session.deptoId : typeof req.session.direccion.DeptoId !== 'undefined' ? req.session.direccion.DeptoId : undefined;
		var locId = typeof req.session.locId !== 'undefined' ? req.session.locId : typeof req.session.direccion.LocId !== "undefined" ? req.session.direccion.LocId : undefined;

		if (!deptoId || !locId || typeof req.session.inscripciones !== "object") {
			return res.serverError(new Error("Parámetros incorrectos"));
		}

		// Armo opciones de plan-ciclo-grado-orientacion-opcion según las inscripciones que tiene
		var planes = Array();
		var ciclos = Array();
		var grados = Array();
		var orientaciones = Array();
		var opciones = Array();
		req.session.inscripciones.forEach(function(inscripcion){
			planes[inscripcion.PlanId.PlanId] = inscripcion.PlanId.PlanNombre;
			ciclos[inscripcion.CicloId.CicloId] = inscripcion.CicloId.CicloDesc;
			grados[inscripcion.GradoId.GradoId] = inscripcion.GradoId.GradoDesc;
			orientaciones[inscripcion.OrientacionId.OrientacionId] = inscripcion.OrientacionId.OrientacionDesc;
			opciones[inscripcion.OpcionId.OpcionId] = inscripcion.OpcionId.OpcionDesc;
		});

		if (planes.length==0 || ciclos.length==0 || grados.length==0 || orientaciones.length==0 || opciones.length==0) {
			return res.serverError(new Error("Parámetros incorrectos"));
		}

		// valores por defecto tomados de la sesión
		req.session.planId = req.session.planId || req.session.inscripciones[0].PlanId.PlanId;
		req.session.cicloId = req.session.cicloId || req.session.inscripciones[0].CicloId.CicloId;
		req.session.gradoId = req.session.gradoId || req.session.inscripciones[0].GradoId.GradoId;
		req.session.orientacionId = req.session.orientacionId || req.session.inscripciones[0].OrientacionId.OrientacionId;
		req.session.opcionId = req.session.opcionId || req.session.inscripciones[0].OpcionId.OpcionId;

		return res.view({deptoId:deptoId,locId:locId,
		                 planes:planes,ciclos:ciclos,grados:grados,orientaciones:orientaciones,opciones:opciones,
		                 planId:req.session.planId,cicloId:req.session.cicloId,gradoId:req.session.gradoId,
		                 orientacionId:req.session.orientacionId,opcionId:req.session.opcionId,
										 mensaje:undefined,
		});
	},

	paso4: function (req, res) {
		var deptoId = req.param('departamento') ? parseInt(req.param('departamento')) : req.session.deptoId;
		var locId = req.param('localidad') ? parseInt(req.param('localidad')) : req.session.locId;
		var planId = req.param('plan') ? parseInt(req.param('plan')) : req.session.planId;
		var cicloId = req.param('ciclo') ? parseInt(req.param('ciclo')) : req.session.cicloId;
		var gradoId = req.param('grado') ? parseInt(req.param('grado')) : req.session.gradoId;
		var orientacionId = req.param('orientacion') ? parseInt(req.param('orientacion')) : req.session.orientacionId;
		var opcionId = req.param('opcion') ? parseInt(req.param('opcion')) : req.session.opcionId;

		var turnoId = 'D'; // por ahora sólo tenemos turno diurno
		var inicioCurso = new Date(req.session.inicioCurso);

		if (!deptoId || !locId || !planId || !cicloId || !gradoId || !orientacionId || !opcionId || !turnoId || !inicioCurso || typeof req.session.persona.perId === 'undefined' || !req.session.direccion.DependId) {
				return res.serverError(new Error("parámetros incorrectos"));
		}

		// busco liceos con lugar para el grado pedido
		Cupos.conLugar(deptoId,locId,planId,cicloId,gradoId,orientacionId,opcionId,inicioCurso,req.session.direccion.DependId,function(err,liceos){
			if (err) {
				return res.serverError(err);
			}

			req.session.deptoId = deptoId;
			req.session.locId = locId;
			req.session.planId = planId;
			req.session.cicloId = cicloId;
			req.session.gradoId = gradoId;
			req.session.orientacionId = orientacionId;
			req.session.opcionId = opcionId;
			req.session.turnoId = turnoId;
			req.session.liceos = liceos;

			if (typeof liceos[0] === 'undefined') {
				return res.view({mensaje:"No hay liceos con cupos disponibles para el curso seleccionado.<br>Más adelante pueden liberarse cupos si otros estudiantes se cambian de liceo."});
			}

			// inicio una reserva de cupo, aunque todavía no es útil porque no tiene dependencia asociada
			Reserva.reservar(req.session.persona.perId,planId,cicloId,gradoId,orientacionId,opcionId,inicioCurso,function(err,reserva) {
				if (err) {
					return res.serverError(err);
				}

				if (!reserva || !reserva.id) {
					console.log("reserva vacía: cédula:"+req.session.perdocid+" reserva:"+reserva.id);
				}

				req.session.reserva = reserva;

				if (req.session.reserva.DependId) {
					console.log("paso4 con la reserva "+req.session.reserva.id+" que ya tiene entrevista asociada");
					return res.redirect(sails.config.baseurl);
				}

				return res.view({liceos:liceos});
			});
		});
	},

	sinCupo: function (req, res) {

		if (!req.session.deptoId) {
			return res.serverError(new Error("parámetros incorrectos"));
		}
		Dependencias.liceos(req.session.deptoId, req.session.locId, function(err,liceos){
			if (err) {
				return res.serverError(err);
			}

			var hoy = new Date();
			var mesActual = hoy.getMonth()+1;
			var diaActual = hoy.getDay();

			return res.view({liceos:liceos,paises:req.session.paises,adulto:req.session.adulto,
				tipo:(req.session.deptoId!=10 ? 'interior' : (mesActual==12 || mesActual==1 || (mesActual==2 && diaActual<24)) ? 'mvd-febrero' : 'mvd'),
			});
		});
	},

// 	sinCupoGuardar: function (req, res) {
// 		var liceo1 = req.param('liceo1');
// 		var liceo2 = req.param('liceo2');
// 		var confirma = req.param('confirma');
// 		var pais_adulto = req.param('pais-adulto');
// 		var doccod_adulto = req.param('doccod-adulto');
// 		var perdocid_adulto = req.param('perdocid-adulto');
// 		var telefono_adulto = req.param('telefono-adulto');
//
// console.log(liceo1);
// console.log(liceo2);
// console.log(confirma);
// console.log(pais_adulto);
// console.log(doccod_adulto);
// console.log(perdocid_adulto);
// console.log(telefono_adulto);
//
// 		return res.redirect(sails.config.baseurl + "form/comprobante");
// 	},

	paso5: function (req, res) {
		var destinoId = req.param('dependId-destino') ? parseInt(req.param('dependId-destino')) : req.session.destinoId;

		if (!destinoId) {
				return res.serverError(new Error("parámetros incorrectos"));
		}

		if (req.session.reserva.DependId) {
			console.log("paso5 con la reserva "+req.session.reserva.id+" que ya tiene entrevista asociada");
			return res.redirect(sails.config.baseurl);
		}

		// valido que el liceo destino haya estado entre los que le ofrecí
		req.session.destino = req.session.liceos.reduce(function(destino,liceo){
			return typeof destino !== 'undefined' ? destino : (liceo.DependId == destinoId ? liceo : undefined);
		}, undefined);
		if (! req.session.destino) {
				// el liceo pedido no está entre los liceos con cupo que le fueron ofrecidos
				return res.serverError(new Error("parámetros incorrectos"));
		}
		req.session.destinoId = destinoId;

		var mensaje = req.session.message;
		req.session.message = undefined;

		return res.view({destinoId:destinoId,fecha:"",hora:"",liceo:req.session.destino,paises:req.session.paises,adulto:req.session.adulto,mensaje:mensaje});
	},

	paso6: function (req, res) {
		var pais_adulto = req.param('pais-adulto') ? req.param('pais-adulto').substr(0,2) : (typeof req.session.adulto !== 'undefined' ? req.session.adulto.pais : undefined);
		var doccod_adulto = req.param('doccod-adulto') ? req.param('doccod-adulto').substr(0,3) : (typeof req.session.adulto !== 'undefined' ? req.session.adulto.doccod : undefined);
		var perdocid_adulto = req.param('perdocid-adulto') ? req.param('perdocid-adulto').replace(/[^0-9a-zA-Z]/g,'').substr(0,15) : (typeof req.session.adulto !== 'undefined' ? req.session.adulto.perdocid : undefined);
		var telefono_adulto = req.param('telefono-adulto') ? req.param('telefono-adulto').substr(0,20) : (typeof req.session.adulto !== 'undefined' ? req.session.adulto.telefono : undefined);;

		var fecha = req.param('Fecha');
		var hora = req.param('Hora');
		var fechaHora = new Date(fecha+" "+hora);

		if (!fecha || !hora || !req.session.destinoId || !req.session.reserva.id) {
			console.log("parámetros incorrectos cédula:"+req.session.perdocid+" destino:"+req.session.destinoId+" reserva:"+req.session.reserva.id);
			return res.serverError(new Error("parámetros incorrectos"));
		}

		if (req.session.reserva.DependId) {
			console.log("paso6 con la reserva "+req.session.reserva.id+" que ya tiene entrevista asociada");
			return res.redirect(sails.config.baseurl);
		}

		req.session.adulto = { pais:pais_adulto, doccod:doccod_adulto, perdocid:perdocid_adulto, telefono:telefono_adulto };

		Entrevista.asociarReserva(req.session.destinoId,fechaHora,req.session.reserva.id,function(err,resultado){
			if (err) {
				return res.serverError(err);
			}
			if (resultado.changedRows < 1) {
				req.session.message = "El horario pedido ya no está disponible";
				return res.redirect(req.headers.referer);
			}

			// el vencimiento de la reserva es a última hora del día
			fechaHora.setHours(23);
			fechaHora.setMinutes(59);
			fechaHora.setSeconds(59);

			Reserva.update({id:req.session.reserva.id},{DependId:req.session.destinoId,Vencimiento:fechaHora,Adulto:req.session.adulto}).exec(function(err,reserva){
				if (err) {
					return res.serverError(err);
				}

				req.session.reserva.DependId=req.session.destinoId;
				req.session.reserva.Vencimiento=fechaHora;
				req.session.reserva.Adulto=req.session.adulto;
				req.session.message = undefined;
				return res.redirect(sails.config.baseurl + "form/comprobante");
			});
		});
	},

	comprobante: function(req, res) {

		if (!req.session.reserva.id || !req.session.persona || !req.session.documento) {
			return res.serverError(new Error("parámetros incorrectos"));
		}

		Reserva.findOne({id:req.session.reserva.id}).exec(function(err,reserva){
			if (err) {
				return res.serverError(err);
			}

			Entrevista.findOne({Reserva:req.session.reserva.id}).populate('DependId').exec(function(err,entrevista){
				if (err) {
					return res.serverError(err);
				}

				if (typeof entrevista === 'undefined') {
					return res.serverError(new Error("No se encuentra una entrevista fijada para solicitar pase"));
				}

				Dependencias.direccion(entrevista.DependId.DependId, function(err,direccion){
					if (err) {
						return res.serverError(err);
					}

					liceo = entrevista.DependId;
					liceo.LugarDireccion = direccion.LugarDireccion;
					liceo.LocNombre = direccion.LocNombre;
					liceo.DeptoNombre = direccion.DeptoNombre;

					if (typeof reserva.Adulto !== 'undefined') {
						if (reserva.Adulto) {
							reserva.Adulto.documento = reserva.Adulto.pais!=='UY' || reserva.Adulto.doccod!=='CI' ? reserva.Adulto.pais+'-'+reserva.Adulto.doccod+'-'+reserva.Adulto.perdocid : reserva.Adulto.perdocid.fmtCedula();
						} else {
							reserva.Adulto = undefined; // puede venir con null y prefiero manejarlo como undefined
						}
					}

					return res.view({fecha:entrevista.FechaHora.fecha_toString(),
							 hora:entrevista.FechaHora.hora_toString(),
							 liceo:entrevista.DependId,
							 persona:req.session.persona,
							 documento:req.session.documento,
							 adulto:reserva.Adulto,
							 fechaHoraDelProceso:reserva.updatedAt.fecha_toString()+' a las '+reserva.updatedAt.hora_toString()
					});
				});
			});
		});
	},
};


Date.prototype.fecha_toString = function() {
        var sprintf = require("sprintf");
				var mes = Array('enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre');
        return sprintf("%d de %s de %d", this.getDate(),mes[this.getMonth()],this.getFullYear());
};
Date.prototype.hora_toString = function() {
        var sprintf = require("sprintf");
        return sprintf("%02d:%02d", this.getHours(),this.getMinutes());
};
String.prototype.fmtCedula = function () {
      return this.replace(/(.)?(...)(...)(.)$/, function(match,millon,mil,unidades,verif) {
				 return millon+'.'+mil+'.'+unidades+'-'+verif;
			 });
};
